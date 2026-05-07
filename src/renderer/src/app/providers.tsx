import { useActiveAccountId } from '@renderer/entities/account';
import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { CatchUpRuntime } from '@renderer/features/catch-up-confirm';
import {
  useTradeNotifications,
  useWatchEventNotifications,
} from '@renderer/features/trade-notifications';
import { createQueryClient } from '@renderer/shared/api/query-client';
import { trpc } from '@renderer/shared/api/trpc';
import { usePopoutVisibility } from '@renderer/shared/lib/popout-window';
import { DialogProvider } from '@renderer/shared/ui';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import superjson from 'superjson';
import { ipcLink } from 'trpc-electron/renderer';

// 시세 cooldown 알림은 toast 폭격 위험으로 제거.
// main 의 event_logs 'quote-feed.cooldown' WARN + reports 의 일일 운영 요약 카드
// (cooldown 종목 카운트/목록) 로 사용자가 사후 확인 가능.

const DisplaySettingsRuntime = (): null => {
  const { settings } = useGetDisplaySettings();
  const rowHeightPx = settings?.grid.rowHeightPx ?? 26;

  useEffect(() => {
    document.documentElement.style.setProperty('--hts-row-height', `${rowHeightPx}px`);
  }, [rowHeightPx]);

  return null;
};

export type AppWindowKind = 'main' | 'popout';

/**
 * 다른 창에서 발생한 설정 변경(매매/보호/시간대/자동감시/안전/백업 등)을 받아 query invalidate.
 * popout 윈도우는 독립 React 트리이므로 tRPC invalidate 가 자동 전파되지 않는 점을 보완한다.
 */
const SettingsSyncRuntime = (): null => {
  const qc = useQueryClient();
  const visible = usePopoutVisibility();
  const visibleRef = useRef(visible);
  const pendingHiddenInvalidationRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    const shell = window.appShell;
    if (!shell?.onSettingsChanged) return;
    return shell.onSettingsChanged(() => {
      if (!visibleRef.current) {
        pendingHiddenInvalidationRef.current = true;
        return;
      }
      // refetchType:'all' 로 background(focus 안 된 부모창)의 inactive query 도 즉시 refetch.
      // default 'active' 는 focus 시까지 대기 → popout 에서 변경 후 부모창 focus 전까지 동기화 지연.
      void qc.invalidateQueries({ refetchType: 'all' });
    });
  }, [qc]);

  useEffect(() => {
    const shell = window.appShell;
    if (!shell?.onPopoutActivated) return;
    return shell.onPopoutActivated(() => {
      if (!pendingHiddenInvalidationRef.current) return;
      pendingHiddenInvalidationRef.current = false;
      void qc.invalidateQueries({ refetchType: 'active' });
    });
  }, [qc]);

  return null;
};

interface MarketSourceStatus {
  isAvailable: boolean;
  isStale: boolean;
  lastError: string | null;
}

const autoRefreshKeys = {
  market: '',
  dart: '',
};

const AiDataAutoRefreshRuntime = ({ enabled }: { enabled: boolean }): null => {
  const utils = trpc.useUtils();
  const marketStatus = trpc.ai.getMarketContextStatus.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
  });
  const dartStatus = trpc.ai.getDartCorpCodeStatus.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
  });
  const marketHadPreviousErrorRef = useRef(false);

  const marketRefresh = trpc.ai.refreshMarketContext.useMutation({
    onSuccess: () => {
      void utils.ai.getMarketContextStatus.invalidate();
      if (marketHadPreviousErrorRef.current) {
        toast.success('KRX/ECOS 컨텍스트 자동 복구 완료');
      }
      marketHadPreviousErrorRef.current = false;
    },
    onError: (err) => {
      toast.error(`KRX/ECOS 자동 갱신 실패: ${err.message}`);
    },
  });
  const dartRefresh = trpc.ai.syncDartCorpCodes.useMutation({
    onSuccess: (res) => {
      void utils.ai.getDartCorpCodeStatus.invalidate();
      if (res.inserted === 0) {
        toast.error(`DART 매핑 자동 갱신 실패: ${res.reason ?? '원인 불명'}`);
      }
    },
    onError: (err) => {
      toast.error(`DART 매핑 자동 갱신 실패: ${err.message}`);
    },
  });

  useEffect(() => {
    const krx = marketStatus.data?.krx;
    const ecos = marketStatus.data?.ecos;
    if (!enabled) return;
    if (!krx && !ecos) return;
    if (marketRefresh.isPending) return;
    const shouldRefresh = sourceNeedsRefresh(krx) || sourceNeedsRefresh(ecos);
    if (!shouldRefresh) return;
    const hadPreviousError = Boolean(krx?.lastError || ecos?.lastError);
    const key = [
      krx?.isAvailable,
      krx?.isStale,
      krx?.lastSuccessAt,
      krx?.lastError,
      ecos?.isAvailable,
      ecos?.isStale,
      ecos?.lastSuccessAt,
      ecos?.lastError,
    ].join('|');
    if (autoRefreshKeys.market === key) return;
    autoRefreshKeys.market = key;
    marketHadPreviousErrorRef.current = hadPreviousError;
    marketRefresh.mutate({});
  }, [
    enabled,
    marketRefresh,
    marketRefresh.isPending,
    marketStatus.data?.ecos,
    marketStatus.data?.krx,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const status = dartStatus.data;
    if (!status?.available || !status.stale) return;
    if (dartRefresh.isPending) return;
    const key = `${status.available}|${status.stale}`;
    if (autoRefreshKeys.dart === key) return;
    autoRefreshKeys.dart = key;
    dartRefresh.mutate();
  }, [dartRefresh, dartRefresh.isPending, dartStatus.data, enabled]);

  return null;
};

const AppNotificationsRuntime = (): null => {
  useWatchEventNotifications();
  useTradeNotifications();
  return null;
};

function sourceNeedsRefresh(status: MarketSourceStatus | undefined): boolean {
  return Boolean(status?.isAvailable && (status.isStale || status.lastError));
}

const MainWindowRuntimes = (): ReactElement => {
  const bootStatus = trpc.boot.getStatus.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.phase === 'runtime-ready' || query.state.data?.phase === 'degraded'
        ? false
        : 500,
    staleTime: 500,
  });
  const runtimeReady = bootStatus.data?.phase === 'runtime-ready';
  const { accountId } = useActiveAccountId();
  return (
    <>
      <AiDataAutoRefreshRuntime enabled={runtimeReady} />
      <AppNotificationsRuntime />
      {runtimeReady ? <CatchUpRuntime accountId={accountId} /> : null}
    </>
  );
};

const PopoutWindowRuntimes = (): ReactElement => <></>;

export const AppProviders = ({
  children,
  windowKind,
}: PropsWithChildren<{ windowKind: AppWindowKind }>): ReactElement => {
  const [queryClient] = useState(() => createQueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      // tRPC v11: transformer를 link 레벨에서 지정
      links: [ipcLink({ transformer: superjson })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <DisplaySettingsRuntime />
        <SettingsSyncRuntime />
        {windowKind === 'main' ? <MainWindowRuntimes /> : <PopoutWindowRuntimes />}
        <Toaster
          position="top-right"
          theme="light"
          toastOptions={{ closeButton: true, duration: 3000 }}
        />
        <DialogProvider />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};

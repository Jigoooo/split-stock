import { trpc } from '@renderer/shared/api/trpc';
import { usePopoutVisibility } from '@renderer/shared/lib/popout-window';
import { useEffect } from 'react';

export function useTradeRuntime() {
  const envQuery = trpc.auth.getEnv.useQuery();
  const envReady = (envQuery.data?.env ?? null) !== null;
  const popoutVisible = usePopoutVisibility();
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: envReady && popoutVisible,
    refetchInterval: popoutVisible ? 5000 : false,
  });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => realtimeStatus.refetch(),
  });

  // isSuccess 는 직전 mutation 성공 플래그 — 계좌/환경 전환으로 서버가 realtime 인스턴스를
  // 재생성하면 `started` 는 false 로 돌아오지만 isSuccess 는 true 로 남아 재시작이 막혔다.
  // `started` 권위 소스 + isPending 중복 호출 가드만으로 충분 (서버 start 는 idempotent).
  useEffect(() => {
    if (!envReady || !popoutVisible) return;
    if (realtimeStatus.data?.started) return;
    if (startRealtime.isPending) return;
    startRealtime.mutate();
  }, [envReady, popoutVisible, realtimeStatus.data?.started, startRealtime]);

  return {
    isProd: envQuery.data?.env === 'PROD',
    isRealtimeStarted: realtimeStatus.data?.started ?? false,
    startRealtimePending: startRealtime.isPending,
    startRealtimeError: startRealtime.error?.message ?? null,
  };
}

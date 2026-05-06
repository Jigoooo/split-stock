import { CryptoMemoForm } from '@renderer/features/crypto-memo';
import { trpc } from '@renderer/shared/api/trpc';
import { type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import {
  TradeHistoryShell,
  type TradeHistoryShellSlots,
} from '@renderer/widgets/trade-history-panel';
import type { CryptoStrategyProfile } from '@shared/contracts';
import { createDefaultCryptoStrategyProfile, DEFAULT_CRYPTO_MARKET } from '@shared/contracts';
import { type ReactElement, useEffect, useMemo, useState, useTransition } from 'react';
import { CryptoAllTradeHistoryPanel } from './crypto-all-trade-history-panel';
import { CryptoAutoStrategyTabBody } from './crypto-auto-panel';
import { CryptoTradeHistoryList } from './crypto-trade-history-list';

export interface CryptoTradeHistoryPanelProps {
  accountId: number;
  /** KRW-BTC 등. 빈 문자열이면 R1 외부 탭은 "모든 매매내역" 한 개. */
  market: string;
}

type R1 = 'symbol' | 'all';

/**
 * 코인 우측 매매내역 컨테이너 — stock MainTradeHistoryPane 와 동등 R1 외부 탭 구조.
 *
 * R1 외부 탭:
 *   - market !== '' → ['<마켓> 매매내역', '모든 매매내역']
 *   - market === '' → ['모든 매매내역'] 한 개
 *
 * 선택된 R1 에 따라 렌더 대상 분기:
 *   - 'symbol' → CryptoSymbolTradeHistoryPanel (TradeHistoryShell — 5탭)
 *   - 'all'    → CryptoAllTradeHistoryPanel (보유 마켓 통합 매매현황)
 */
export const CryptoTradeHistoryPanel = ({
  accountId,
  market,
}: CryptoTradeHistoryPanelProps): ReactElement => {
  const [r1, setR1Raw] = useState<R1>(market.length > 0 ? 'symbol' : 'all');
  const [, startTransition] = useTransition();
  const setR1 = (next: R1): void => {
    startTransition(() => setR1Raw(next));
  };

  const effectiveR1: R1 = market.length === 0 ? 'all' : r1;

  const marketsQuery = trpc.crypto.listMarkets.useQuery(
    { quoteCurrency: 'KRW', limit: 200 },
    { enabled: market.length > 0, staleTime: 60_000 },
  );
  const marketEntry = useMemo(
    () => marketsQuery.data?.entries.find((entry) => entry.market === market) ?? null,
    [market, marketsQuery.data?.entries],
  );
  const symbolTabLabel =
    market.length === 0 ? null : `${formatMarketLabel(marketEntry?.koreanName, market)} 매매내역`;

  const tabs: ReadonlyArray<HtsTabItem<R1>> =
    market.length > 0
      ? [
          { id: 'symbol', label: symbolTabLabel ?? `${market} 매매내역` },
          { id: 'all', label: '모든 매매내역' },
        ]
      : [{ id: 'all', label: '모든 매매내역' }];

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label="코인 우측 매매내역 패널"
    >
      <HtsTabs tabs={tabs} active={effectiveR1} onChange={setR1} ariaLabel="코인 우측 외부 탭" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {effectiveR1 === 'all' ? (
          <CryptoAllTradeHistoryPanel accountId={accountId} />
        ) : (
          <CryptoSymbolTradeHistoryPanel accountId={accountId} market={market} />
        )}
      </div>
    </section>
  );
};

/**
 * 코인 단일 마켓 매매내역 패널 — 기존 5탭 구조 (TradeHistoryShell).
 *
 * 탭별 내용:
 *  - all/open/closed : CryptoTradeHistoryList (status 필터)
 *  - strategy        : market 필요. CryptoAutoStrategyTabBody
 *  - memo            : market 필요. CryptoMemoForm
 */
const CryptoSymbolTradeHistoryPanel = ({
  accountId,
  market,
}: {
  accountId: number;
  market: string;
}): ReactElement => {
  const symbol = market.length > 0 ? market : null;

  const slots: TradeHistoryShellSlots = {
    configPanel: (selectedMarket) => (
      <CryptoStrategyTabBodyContainer accountId={accountId} market={selectedMarket} />
    ),
    historyPanel: (status, selectedSymbol) => (
      <CryptoTradeHistoryList accountId={accountId} market={selectedSymbol} status={status} />
    ),
    memoPanel: (selectedMarket) => <CryptoMemoForm market={selectedMarket} />,
  };

  return (
    <TradeHistoryShell
      symbol={symbol}
      ariaLabel="코인 매매내역 패널"
      symbolHintText={{
        strategy: '좌측에서 마켓을 선택하면 해당 마켓의 자동매매 설정을 편집할 수 있습니다.',
        memo: '좌측에서 마켓을 선택하면 해당 마켓의 메모를 편집할 수 있습니다.',
      }}
      slots={slots}
    />
  );
};

/**
 * crypto-main-page 의 strategy 탭 동작을 그대로 재현 — strategy load + 저장 mutation +
 * 템플릿 mutation. main-page 에서 분리해 wrapper 자기 안에서 caching.
 */
const CryptoStrategyTabBodyContainer = ({
  accountId,
  market,
}: {
  accountId: number;
  market: string;
}): ReactElement => {
  const utils = trpc.useUtils();
  const enabled = accountId > 0 && market.startsWith('KRW-');

  const [autoStrategyProfile, setAutoStrategyProfile] = useState<CryptoStrategyProfile>(() =>
    createDefaultCryptoStrategyProfile(
      (market || DEFAULT_CRYPTO_MARKET) as CryptoStrategyProfile['market'],
    ),
  );

  const autoStrategyQuery = trpc.crypto.getAutoStrategy.useQuery(
    { accountId, market },
    { enabled, staleTime: 3000 },
  );
  const autoTemplatesQuery = trpc.crypto.listAutoStrategyTemplates.useQuery(
    { accountId },
    { enabled: accountId > 0, staleTime: 10_000 },
  );
  const saveAutoStrategy = trpc.crypto.saveAutoStrategy.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
        utils.crypto.getAutoStrategy.invalidate({ accountId, market }),
      ]);
    },
  });
  const saveAutoStrategyTemplate = trpc.crypto.saveAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate({ accountId });
    },
  });
  const deleteAutoStrategyTemplate = trpc.crypto.deleteAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate({ accountId });
    },
  });

  useEffect(() => {
    const applyProfile = (next: CryptoStrategyProfile): void => {
      setAutoStrategyProfile((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    if (autoStrategyQuery.data?.profile) {
      applyProfile(autoStrategyQuery.data.profile);
      return;
    }
    applyProfile(
      createDefaultCryptoStrategyProfile(
        (market || DEFAULT_CRYPTO_MARKET) as CryptoStrategyProfile['market'],
      ),
    );
  }, [autoStrategyQuery.data?.profile, market]);

  return (
    <CryptoAutoStrategyTabBody
      accountId={accountId}
      market={market}
      onDeleteTemplate={(id) => deleteAutoStrategyTemplate.mutate({ accountId, id })}
      onSaveTemplate={(name, profile) =>
        saveAutoStrategyTemplate.mutate({ accountId, name, strategy: profile })
      }
      onStrategySave={(profile) => {
        setAutoStrategyProfile(profile);
        saveAutoStrategy.mutate({ accountId, market, profile });
      }}
      pending={
        saveAutoStrategy.isPending ||
        saveAutoStrategyTemplate.isPending ||
        deleteAutoStrategyTemplate.isPending
      }
      strategy={autoStrategyProfile}
      strategyLoading={autoStrategyQuery.isFetching}
      templates={autoTemplatesQuery.data?.templates ?? []}
    />
  );
};

function formatMarketLabel(name: string | null | undefined, market: string): string {
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName === market) return market;
  return `${trimmedName} (${market})`;
}

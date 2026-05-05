import { useCryptoTradeCycles } from '@renderer/entities/account-crypto';
import { CryptoMemoForm } from '@renderer/features/crypto-memo';
import { trpc } from '@renderer/shared/api/trpc';
import {
  TradeHistoryShell,
  type TradeHistoryShellSlots,
} from '@renderer/widgets/trade-history-panel';
import type { CryptoStrategyProfile } from '@shared/contracts';
import { createDefaultCryptoStrategyProfile } from '@shared/contracts';
import { type ReactElement, useEffect, useState } from 'react';
import { getCryptoQuote } from '../model/crypto-format';
import { CryptoAutoStrategyTabBody } from './crypto-auto-panel';
import { CryptoCyclesPanel } from './crypto-cycles-panel';

export interface CryptoTradeHistoryPanelProps {
  accountId: number;
  /** KRW-BTC 등. 빈 문자열이면 strategy/memo 탭 비활성화 (TradeHistoryShell 동작). */
  market: string;
}

/**
 * 코인 우측 매매내역 패널 — TradeHistoryShell 사용으로 stock TradeHistoryPanel
 * 과 5탭 layout 100% 동등.
 *
 * 탭별 내용:
 *  - all/open/closed : (Q3 통합 컬럼 적용 전 임시) CryptoCyclesPanel — closed 탭 외에는 동일 표시
 *  - strategy        : market 필요. CryptoAutoStrategyTabBody (코인 자동매매 설정 + 템플릿)
 *  - memo            : market 필요. CryptoMemoForm
 *
 * market 이 빈 문자열이면 shell 이 strategy/memo 탭 비활성화 + "종목 선택" badge.
 */
export const CryptoTradeHistoryPanel = ({
  accountId,
  market,
}: CryptoTradeHistoryPanelProps): ReactElement => {
  const symbol = market.length > 0 ? market : null;

  const slots: TradeHistoryShellSlots = {
    configPanel: (selectedMarket) => (
      <CryptoStrategyTabBodyContainer accountId={accountId} market={selectedMarket} />
    ),
    historyPanel: (status, selectedSymbol) => (
      <CryptoCyclesContainer
        accountId={accountId}
        market={selectedSymbol ?? market}
        status={status}
      />
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
    createDefaultCryptoStrategyProfile((market || 'KRW-BTC') as CryptoStrategyProfile['market']),
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
      createDefaultCryptoStrategyProfile((market || 'KRW-BTC') as CryptoStrategyProfile['market']),
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

/**
 * 코인 cycles container — Q3 (TradeHistoryList 동등 컬럼 통일) 전 임시. closed 만 의미있는 데이터,
 * all/open 도 동일 컴포넌트에 status pass 하지만 현재 CryptoCyclesPanel 은 closed-only 표시.
 *
 * Q3 에서 status 별 적절한 컬럼/필터로 분기 — adapter 도입 예정.
 */
const CryptoCyclesContainer = ({
  accountId,
  market,
  status,
}: {
  accountId: number;
  market: string;
  status: 'all' | 'open' | 'closed';
}): ReactElement => {
  const enabled = accountId > 0 && market.startsWith('KRW-');
  const cycles = useCryptoTradeCycles(accountId, market);
  const quote = getCryptoQuote(market);

  // Q3 전 임시: status 무관하게 closed 사이클 표시 (closed-only 데이터). all/open 도 동일 .
  void status;

  return (
    <CryptoCyclesPanel enabled={enabled} market={market} cycles={cycles.cycles} quote={quote} />
  );
};

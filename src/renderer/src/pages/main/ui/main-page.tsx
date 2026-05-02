import { useActiveAccountId } from '@renderer/entities/account';
import {
  type AddWatchOrderPrefillPayload,
  storeAddWatchOrderPrefill,
  type WatchOrderFormPrefill,
} from '@renderer/features/add-watch-order';
import { StrategyPreviewModalHost } from '@renderer/features/ai-strategy-recommend';
import { RecommendModalHost } from '@renderer/features/ai-symbol-recommend';
import type { ReactElement } from 'react';
import { useMainRealtime } from '../model/use-main-realtime';
import { useMainSelection } from '../model/use-main-selection';
import { useMainTradingContext } from '../model/use-main-trading-context';
import { CryptoMainPage } from './crypto-main-page';
import { MainAccountLoading, MainNoAccount } from './main-account-status';
import { MainBottomSection } from './main-bottom-section';
import { MainPositionsPane } from './main-positions-pane';
import { MainThreeSplitLayout } from './main-three-split-layout';
import { MainTradeHistoryPane } from './main-trade-history-pane';

export interface MainPageProps {
  onOpenStrategySettings?: (() => void) | undefined;
  onOpenStockPicker?: (() => Promise<void> | void) | undefined;
}

/**
 * 메인 페이지 — 상단(좌/우 split: 포지션/매매내역) + 하단(주문 섹션) vertical split.
 *
 * - 상단 70% (min 35%) :
 *     - 좌측 60% (min 35%) : MainPositionsGridPane
 *     - 우측 40% (min 25%) : MainTradeHistoryPane
 * - 하단 30% (min 25%) : 선택 종목 기준 차트 + 주문 패널
 * - activeAccountId 없으면 안내 패널만 표시 (login 화면을 따로 두지 않고 shell 레벨).
 */
export const MainPage = ({
  onOpenStockPicker,
  onOpenStrategySettings,
}: MainPageProps): ReactElement => {
  const { account, accountId, isPending: isAccountPending } = useActiveAccountId();

  if (isAccountPending) {
    return <MainAccountLoading />;
  }

  if (accountId === null) {
    return <MainNoAccount />;
  }

  if (account?.broker === 'UPBIT') {
    return <CryptoMainPage accountId={accountId} />;
  }

  return (
    <StockMainPage
      accountId={accountId}
      onOpenStockPicker={onOpenStockPicker}
      onOpenStrategySettings={onOpenStrategySettings}
    />
  );
};

function StockMainPage({
  accountId,
  onOpenStockPicker,
  onOpenStrategySettings,
}: MainPageProps & { accountId: number }): ReactElement {
  useMainRealtime();

  const { selectedPdno, selectedStock, setSelectedPdno, setSelectedStock } = useMainSelection();

  const { isProd, overlayLines, selectedEntry, tradeHistoryEntry } = useMainTradingContext(
    selectedPdno,
    selectedStock,
  );

  const openAddWatchOrderPopout = (prefill: WatchOrderFormPrefill | null): void => {
    const payload: AddWatchOrderPrefillPayload = { accountId, prefill };
    storeAddWatchOrderPrefill(payload);
    void window.appShell?.openPopout('add-watch-order');
  };

  return (
    <MainThreeSplitLayout
      layoutIds={{
        horizontal: 'split-stock.layout.main.split',
        vertical: 'split-stock.layout.main.vertical',
      }}
      left={
        <MainPositionsPane
          accountId={accountId}
          selectedPdno={selectedPdno}
          onSelect={setSelectedPdno}
        />
      }
      right={
        <MainTradeHistoryPane
          accountId={accountId}
          selectedPdno={tradeHistoryEntry?.pdno ?? null}
          selectedName={tradeHistoryEntry?.name ?? null}
          onOpenStrategySettings={onOpenStrategySettings}
        />
      }
      bottom={
        <MainBottomSection
          isProd={isProd}
          onOpenStockPicker={onOpenStockPicker}
          overlayLines={overlayLines}
          selectedEntry={selectedEntry}
          onSelectStock={(entry) => setSelectedStock({ pdno: entry.pdno, name: entry.name })}
        />
      }
      after={
        <>
          <RecommendModalHost
            onPick={(pdno, pdName) => {
              openAddWatchOrderPopout({ pdno, pdName });
            }}
          />
          <StrategyPreviewModalHost />
        </>
      }
    />
  );
}

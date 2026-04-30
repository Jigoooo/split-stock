import { useActiveAccountId } from '@renderer/entities/account';
import {
  type AddWatchOrderPrefillPayload,
  storeAddWatchOrderPrefill,
  type WatchOrderFormPrefill,
} from '@renderer/features/add-watch-order';
import { StrategyPreviewModalHost } from '@renderer/features/ai-strategy-recommend';
import { RecommendModalHost } from '@renderer/features/ai-symbol-recommend';
import type { ReactElement } from 'react';
import { Group, type Layout, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useMainRealtime } from '../model/use-main-realtime';
import { useMainSelection } from '../model/use-main-selection';
import { useMainTradingContext } from '../model/use-main-trading-context';
import { MainAccountLoading, MainNoAccount } from './main-account-status';
import { MainBottomSection } from './main-bottom-section';
import { MainPositionsPane } from './main-positions-pane';
import { MainTradeHistoryPane } from './main-trade-history-pane';

const HORIZONTAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      width: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'col-resize',
    }}
  />
);

const VERTICAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      height: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'row-resize',
    }}
  />
);

const panelStyle = { overflow: 'hidden' } as const;

const RESIZE_HIT_AREA = { coarse: 8, fine: 6 } as const;

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
  useMainRealtime();

  const { accountId, isPending: isAccountPending } = useActiveAccountId();
  const { selectedPdno, selectedStock, setSelectedPdno, setSelectedStock } = useMainSelection();

  const layout = useDefaultLayout({
    id: 'split-stock.layout.main.split',
    storage: localStorage,
  });
  const verticalLayout = useDefaultLayout({
    id: 'split-stock.layout.main.vertical',
    storage: localStorage,
  });

  const { isProd, overlayLines, selectedEntry, tradeHistoryEntry } = useMainTradingContext(
    selectedPdno,
    selectedStock,
  );

  if (isAccountPending) {
    return <MainAccountLoading />;
  }

  if (accountId === null) {
    return <MainNoAccount />;
  }

  const openAddWatchOrderPopout = (prefill: WatchOrderFormPrefill | null): void => {
    const payload: AddWatchOrderPrefillPayload = { accountId, prefill };
    storeAddWatchOrderPrefill(payload);
    void window.appShell?.openPopout('add-watch-order');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Group
        orientation="vertical"
        defaultLayout={(verticalLayout.defaultLayout ?? [70, 30]) as Layout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
        resizeTargetMinimumSize={RESIZE_HIT_AREA}
      >
        <Panel id="main-top" defaultSize={70} minSize={35} style={panelStyle}>
          <Group
            orientation="horizontal"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            resizeTargetMinimumSize={RESIZE_HIT_AREA}
          >
            <Panel id="main-left" defaultSize={60} minSize={35} style={panelStyle}>
              <MainPositionsPane
                accountId={accountId}
                selectedPdno={selectedPdno}
                onSelect={setSelectedPdno}
              />
            </Panel>
            {HORIZONTAL_SEPARATOR}
            <Panel id="main-right" defaultSize={40} minSize={25} style={panelStyle}>
              <MainTradeHistoryPane
                accountId={accountId}
                selectedPdno={tradeHistoryEntry?.pdno ?? null}
                selectedName={tradeHistoryEntry?.name ?? null}
                onOpenStrategySettings={onOpenStrategySettings}
              />
            </Panel>
          </Group>
        </Panel>
        {VERTICAL_SEPARATOR}
        <Panel id="main-bottom" defaultSize={30} minSize={20} style={panelStyle}>
          <MainBottomSection
            isProd={isProd}
            onOpenStockPicker={onOpenStockPicker}
            overlayLines={overlayLines}
            selectedEntry={selectedEntry}
            onSelectStock={(entry) => setSelectedStock({ pdno: entry.pdno, name: entry.name })}
          />
        </Panel>
      </Group>
      <RecommendModalHost
        onPick={(pdno, pdName) => {
          openAddWatchOrderPopout({ pdno, pdName });
        }}
      />
      <StrategyPreviewModalHost />
    </div>
  );
};

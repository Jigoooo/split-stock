import { TradeSelectionBar } from '@renderer/entities/stock';
import { Button, EmptyState } from '@renderer/shared/ui';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import type { ReactElement } from 'react';
import type { MainSelectedEntry } from '../model/use-main-trading-context';

interface MainBottomSectionProps {
  isProd: boolean;
  onOpenStockPicker?: (() => Promise<void> | void) | undefined;
  onSelectStock: (entry: MainSelectedEntry) => void;
  overlayLines: LotOverlayLine[];
  selectedEntry: MainSelectedEntry | null;
}

export const MainBottomSection = ({
  isProd,
  onOpenStockPicker,
  onSelectStock,
  overlayLines,
  selectedEntry,
}: MainBottomSectionProps): ReactElement => {
  const openStockPicker = (): void => {
    if (onOpenStockPicker) {
      void onOpenStockPicker();
      return;
    }
    void window.appShell?.openPopout?.('stock-picker');
  };

  return (
    <div className="main-bottom-section">
      <TradeSelectionBar selected={selectedEntry} onSelect={onSelectStock} compact hideSyncButton />
      {selectedEntry ? (
        <div className="trade-workspace-grid main-bottom-section__content">
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PositionChart
              pdno={selectedEntry.pdno}
              name={selectedEntry.name}
              lines={overlayLines}
              enableDrawingTools={false}
            />
          </div>
          <div
            style={{
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <TradingPanel pdno={selectedEntry.pdno} name={selectedEntry.name} isProd={isProd} />
          </div>
        </div>
      ) : (
        <div className="panel main-bottom-section__empty">
          <EmptyState
            title="주문할 종목을 선택하세요"
            description="상단 검색에서 종목을 고르거나 별도 종목 선택 창을 열면 차트와 주문 패널이 함께 표시됩니다."
            action={
              <Button type="button" variant="primary" dense onClick={openStockPicker}>
                종목 선택
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
};

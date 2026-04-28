import { usePositionOverlay } from '@renderer/entities/account';
import { TradeSelectionBar } from '@renderer/entities/stock';
import { Button } from '@renderer/shared/ui';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useTradeRuntime } from '../model/use-trade-runtime';
import { useTradeSelection } from '../model/use-trade-selection';

export interface TradePageProps {
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
}

/**
 * 주문 팝아웃 전용 페이지.
 * 자체 selection(useTradeSelection) + runtime(useTradeRuntime)을 유지한다.
 */
export const TradePage = ({
  onOpenStockPickerPopout,
  isStockPickerPopoutOpen = false,
}: TradePageProps): ReactElement => {
  const { selected, setSelected } = useTradeSelection();
  const runtime = useTradeRuntime();
  const overlay = usePositionOverlay(selected?.pdno ?? null, { includeSold: true });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.2rem',
        height: '100%',
        minHeight: 0,
      }}
    >
      <TradeSelectionBar
        isStockPickerPopoutOpen={isStockPickerPopoutOpen}
        onOpenStockPickerPopout={onOpenStockPickerPopout}
        selected={selected}
        onSelect={(entry) => setSelected({ pdno: entry.pdno, name: entry.name })}
      />

      {selected ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(680px, 1.05fr)',
            gap: '1.2rem',
          }}
        >
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PositionChart
              pdno={selected.pdno}
              name={selected.name}
              lines={overlay.lines}
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
            <TradingPanel pdno={selected.pdno} name={selected.name} isProd={runtime.isProd} />
          </div>
        </div>
      ) : (
        <EmptyTradeSelection onOpenStockPickerPopout={onOpenStockPickerPopout} />
      )}
    </div>
  );
};

function EmptyTradeSelection({
  onOpenStockPickerPopout,
}: {
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
}): ReactElement {
  return (
    <div
      className="panel"
      role="status"
      style={{
        alignItems: 'center',
        display: 'grid',
        flex: 1,
        gap: '0.8rem',
        justifyItems: 'center',
        minHeight: 0,
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <strong style={{ fontSize: '1.1rem' }}>거래할 종목을 선택하세요</strong>
        <span className="muted">선택 후 차트와 주문 패널을 함께 확인할 수 있습니다.</span>
      </div>
      {onOpenStockPickerPopout ? (
        <Button type="button" variant="primary" onClick={() => void onOpenStockPickerPopout()}>
          종목 선택
        </Button>
      ) : null}
    </div>
  );
}

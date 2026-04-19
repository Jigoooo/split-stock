import { usePositionOverlay } from '@renderer/entities/account';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useTradeRuntime } from '../model/use-trade-runtime';
import { useTradeSelection } from '../model/use-trade-selection';
import { TradeSelectionBar } from './trade-selection-bar';

export interface TradePageProps {
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
}

/**
 * 주문 전용 페이지.
 * 레이아웃(항상 동일):
 *   1) 상단: 종목 검색 인풋 (autocomplete) + 현재 선택 칩
 *   2) 중단: 차트 (일/주/월 탭)
 *   3) 하단: 호가창/체결창/주문 티켓 (실시간 자동 시작)
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
            gridTemplateColumns: 'minmax(360px, 1fr) minmax(640px, 760px)',
            gap: '1.2rem',
          }}
        >
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <PositionChart pdno={selected.pdno} name={selected.name} lines={overlay.lines} />
          </div>
          <div
            style={{
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
            }}
          >
            <TradingPanel pdno={selected.pdno} name={selected.name} isProd={runtime.isProd} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

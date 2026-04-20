import { usePositionOverlay } from '@renderer/entities/account';
import { PositionChart } from '@renderer/widgets/position-chart';
import type { StockListEntry } from '@renderer/widgets/stock-picker-list';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { TradeSelectionBar } from './trade-selection-bar';

export interface TradeWorkspaceProps {
  selected: { pdno: string; name: string } | null;
  onSelect: (entry: StockListEntry) => void;
  isProd: boolean;
  /** 팝아웃 창에서 StockPicker 팝아웃 버튼 표시용. 없으면 버튼 미표시. */
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
  /** 종목 선택바(TradeSelectionBar) 숨김 여부. 메인 페이지 하단 마운트 시 중복 제거용. */
  hideSelectionBar?: boolean;
}

/**
 * 종목 선택바 + 차트 + 주문 패널을 묶은 재사용 위젯.
 *
 * - TradePage (popout 창): useTradeSelection/useTradeRuntime 유지, 이 컴포넌트를 렌더링
 * - MainPage (embedded): useMainSelection 기반 selected 주입, onOpenStockPickerPopout 미전달
 */
export const TradeWorkspace = ({
  selected,
  onSelect,
  isProd,
  onOpenStockPickerPopout,
  isStockPickerPopoutOpen = false,
  hideSelectionBar = false,
}: TradeWorkspaceProps): ReactElement => {
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
      {!hideSelectionBar && (
        <TradeSelectionBar
          isStockPickerPopoutOpen={isStockPickerPopoutOpen}
          onOpenStockPickerPopout={onOpenStockPickerPopout}
          selected={selected}
          onSelect={onSelect}
        />
      )}

      {hideSelectionBar && !selected && (
        <div
          className="muted"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.1rem',
          }}
        >
          위 잔고 목록에서 종목을 클릭하면 차트·주문 화면이 표시됩니다.
        </div>
      )}

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
              overflow: 'hidden',
            }}
          >
            <TradingPanel pdno={selected.pdno} name={selected.name} isProd={isProd} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

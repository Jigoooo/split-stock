import { TradeWorkspace } from '@renderer/widgets/trade-workspace';
import type { ReactElement } from 'react';
import { useTradeRuntime } from '../model/use-trade-runtime';
import { useTradeSelection } from '../model/use-trade-selection';

export interface TradePageProps {
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
}

/**
 * 주문 팝아웃 전용 페이지.
 * 자체 selection(useTradeSelection) + runtime(useTradeRuntime)을 유지하며
 * TradeWorkspace 위젯에 위임한다.
 */
export const TradePage = ({
  onOpenStockPickerPopout,
  isStockPickerPopoutOpen = false,
}: TradePageProps): ReactElement => {
  const { selected, setSelected } = useTradeSelection();
  const runtime = useTradeRuntime();

  return (
    <TradeWorkspace
      selected={selected}
      onSelect={(entry) => setSelected({ pdno: entry.pdno, name: entry.name })}
      isProd={runtime.isProd}
      onOpenStockPickerPopout={onOpenStockPickerPopout}
      isStockPickerPopoutOpen={isStockPickerPopoutOpen}
    />
  );
};

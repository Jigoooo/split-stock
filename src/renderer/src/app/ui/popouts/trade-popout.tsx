import { TradePage } from '@renderer/pages/trade';
import type { ReactElement } from 'react';
import type { PopoutApi } from '../../model/use-popout-state';

export const TradePopout = ({ popout }: { popout: PopoutApi }): ReactElement => (
  <TradePage
    isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
    onOpenStockPickerPopout={() => popout.popout('stock-picker')}
  />
);

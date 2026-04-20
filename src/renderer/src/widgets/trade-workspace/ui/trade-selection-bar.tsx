import { type StockListEntry, StockPickerList } from '@renderer/widgets/stock-picker-list';
import type { ReactElement } from 'react';

export interface TradeSelectionBarProps {
  selected: { pdno: string; name: string } | null;
  onSelect: (entry: StockListEntry) => void;
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
}

export const TradeSelectionBar = ({
  selected,
  onSelect,
  onOpenStockPickerPopout,
  isStockPickerPopoutOpen = false,
}: TradeSelectionBarProps): ReactElement => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <StockPickerList
          {...(selected ? { selectedPdno: selected.pdno } : {})}
          isPopoutOpen={isStockPickerPopoutOpen}
          onOpenPopout={onOpenStockPickerPopout}
          onSelect={onSelect}
        />
      </div>
      {selected ? (
        <span className="chip chip--up">
          {selected.name} ({selected.pdno})
        </span>
      ) : null}
    </div>
  );
};

import type { ReactElement } from 'react';
import type { StockListEntry } from '../model/use-stock-list';
import { StockPickerList } from './stock-picker-list';

export interface TradeSelectionBarProps {
  selected: { pdno: string; name: string } | null;
  onSelect: (entry: StockListEntry) => void;
  onOpenStockPickerPopout?: (() => Promise<void> | void) | undefined;
  isStockPickerPopoutOpen?: boolean | undefined;
  compact?: boolean | undefined;
  hideSyncButton?: boolean | undefined;
}

export const TradeSelectionBar = ({
  compact = false,
  hideSyncButton = false,
  selected,
  onSelect,
  onOpenStockPickerPopout,
  isStockPickerPopoutOpen = false,
}: TradeSelectionBarProps): ReactElement => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      <div
        style={{
          flex: compact ? '0 1 34rem' : 1,
          minWidth: compact ? 220 : 280,
          maxWidth: compact ? '38rem' : undefined,
        }}
      >
        <StockPickerList
          {...(selected ? { selectedPdno: selected.pdno } : {})}
          hideSyncButton={hideSyncButton}
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

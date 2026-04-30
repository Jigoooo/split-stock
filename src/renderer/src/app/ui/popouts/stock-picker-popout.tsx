import { StockPickerList } from '@renderer/entities/stock';
import type { ReactElement } from 'react';

export const StockPickerPopout = (): ReactElement => (
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <StockPickerList
      alwaysOpen
      hidePopoutButton
      onSelect={(entry) => {
        window.appShell?.assignStock?.(entry.pdno, entry.name);
      }}
    />
  </div>
);

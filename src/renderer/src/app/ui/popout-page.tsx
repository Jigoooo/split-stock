import { ProfitCalculatorPage } from '@renderer/features/profit-calculator';
import { DashboardPage } from '@renderer/pages/dashboard';
import { LogsPage } from '@renderer/pages/logs';
import { ReportsPage } from '@renderer/pages/reports';
import { SettingsPage } from '@renderer/pages/settings';
import { TradePage } from '@renderer/pages/trade';
import { StockPickerList } from '@renderer/widgets/stock-picker-list';
import type { ReactElement } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

export interface PopoutPageProps {
  route: PopoutRoute;
  popout: PopoutApi;
}

export const PopoutPage = ({ route, popout }: PopoutPageProps): ReactElement => {
  return (
    <div style={{ padding: '1rem', height: '100vh', overflow: 'auto' }}>
      {route === 'dashboard' ? (
        <DashboardPage />
      ) : route === 'trade' ? (
        <TradePage
          isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
          onOpenStockPickerPopout={() => popout.popout('stock-picker')}
        />
      ) : route === 'logs' ? (
        <LogsPage />
      ) : route === 'reports' ? (
        <ReportsPage />
      ) : route === 'stock-picker' ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <StockPickerList
            alwaysOpen
            hidePopoutButton
            onSelect={(entry) => {
              window.appShell?.assignStock?.(entry.pdno, entry.name);
            }}
          />
        </div>
      ) : route === 'profit-calculator' ? (
        <ProfitCalculatorPage />
      ) : (
        <SettingsPage />
      )}
    </div>
  );
};

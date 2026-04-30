import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { getPopoutWindowTitle } from '@shared/popout';
import { lazy, type ReactElement, Suspense, useEffect } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

const TradePopout = lazy(() =>
  import('./popouts/trade-popout').then((m) => ({ default: m.TradePopout })),
);
const LogsPopout = lazy(() =>
  import('./popouts/logs-popout').then((m) => ({ default: m.LogsPopout })),
);
const ReportsPopout = lazy(() =>
  import('./popouts/reports-popout').then((m) => ({ default: m.ReportsPopout })),
);
const SettingsPopout = lazy(() =>
  import('./popouts/settings-popout').then((m) => ({ default: m.SettingsPopout })),
);
const StockPickerPopout = lazy(() =>
  import('./popouts/stock-picker-popout').then((m) => ({ default: m.StockPickerPopout })),
);
const ProfitCalculatorPopout = lazy(() =>
  import('./popouts/profit-calculator-popout').then((m) => ({
    default: m.ProfitCalculatorPopout,
  })),
);
const AddAccountPopout = lazy(() =>
  import('./popouts/add-account-popout').then((m) => ({ default: m.AddAccountPopout })),
);
const AddWatchOrderPopout = lazy(() =>
  import('./popouts/add-watch-order-popout').then((m) => ({
    default: m.AddWatchOrderPopout,
  })),
);

export interface PopoutPageProps {
  route: PopoutRoute;
  popout: PopoutApi;
}

export const PopoutPage = ({ route, popout }: PopoutPageProps): ReactElement => {
  const isEdgeToEdgeRoute = route === 'add-watch-order' || route === 'add-account';
  // settings 페이지는 자체 sticky 탭 + 내부 스크롤을 사용하므로 외부 wrapper 의 overflow 를 hidden 으로
  // 두어 이중 스크롤바를 방지한다.
  const isInternallyScrolled = route === 'settings';
  useEffect(() => {
    if (route === 'add-watch-order') return;
    document.title = getPopoutWindowTitle(route);
  }, [route]);

  let content: ReactElement;
  switch (route) {
    case 'trade':
      content = <TradePopout popout={popout} />;
      break;
    case 'logs':
      content = <LogsPopout />;
      break;
    case 'reports':
      content = <ReportsPopout />;
      break;
    case 'stock-picker':
      content = <StockPickerPopout />;
      break;
    case 'profit-calculator':
      content = <ProfitCalculatorPopout />;
      break;
    case 'add-account':
      content = <AddAccountPopout />;
      break;
    case 'add-watch-order':
      content = <AddWatchOrderPopout />;
      break;
    case 'settings':
      content = <SettingsPopout />;
      break;
  }

  return (
    <div
      style={{
        padding: isEdgeToEdgeRoute ? 0 : '1rem',
        height: isEdgeToEdgeRoute ? undefined : '100vh',
        overflow: isEdgeToEdgeRoute ? 'visible' : isInternallyScrolled ? 'hidden' : 'auto',
        display: isInternallyScrolled ? 'flex' : undefined,
        flexDirection: isInternallyScrolled ? 'column' : undefined,
        minHeight: 0,
      }}
    >
      <Suspense fallback={<div style={{ padding: '1rem' }}>{LOADING_MESSAGES.ROUTE_LOADING}</div>}>
        {content}
      </Suspense>
    </div>
  );
};

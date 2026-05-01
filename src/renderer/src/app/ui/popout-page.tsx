import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { getPopoutLabel, getPopoutWindowTitle } from '@shared/popout';
import { lazy, type ReactElement, Suspense, useEffect } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

const loadTradePopout = () =>
  import('./popouts/trade-popout').then((m) => ({ default: m.TradePopout }));
const loadLogsPopout = () =>
  import('./popouts/logs-popout').then((m) => ({ default: m.LogsPopout }));
const loadReportsPopout = () =>
  import('./popouts/reports-popout').then((m) => ({ default: m.ReportsPopout }));
const loadSettingsPopout = () =>
  import('./popouts/settings-popout').then((m) => ({ default: m.SettingsPopout }));
const loadStockPickerPopout = () =>
  import('./popouts/stock-picker-popout').then((m) => ({ default: m.StockPickerPopout }));
const loadProfitCalculatorPopout = () =>
  import('./popouts/profit-calculator-popout').then((m) => ({
    default: m.ProfitCalculatorPopout,
  }));
const loadAddAccountPopout = () =>
  import('./popouts/add-account-popout').then((m) => ({ default: m.AddAccountPopout }));
const loadAddWatchOrderPopout = () =>
  import('./popouts/add-watch-order-popout').then((m) => ({
    default: m.AddWatchOrderPopout,
  }));

const TradePopout = lazy(loadTradePopout);
const LogsPopout = lazy(loadLogsPopout);
const ReportsPopout = lazy(loadReportsPopout);
const SettingsPopout = lazy(loadSettingsPopout);
const StockPickerPopout = lazy(loadStockPickerPopout);
const ProfitCalculatorPopout = lazy(loadProfitCalculatorPopout);
const AddAccountPopout = lazy(loadAddAccountPopout);
const AddWatchOrderPopout = lazy(loadAddWatchOrderPopout);

const popoutPrewarmLoaders = {
  trade: loadTradePopout,
  logs: loadLogsPopout,
  reports: loadReportsPopout,
  settings: loadSettingsPopout,
  'stock-picker': loadStockPickerPopout,
  'profit-calculator': loadProfitCalculatorPopout,
  'add-account': loadAddAccountPopout,
  'add-watch-order': loadAddWatchOrderPopout,
} satisfies Record<PopoutRoute, () => Promise<unknown>>;

export function prewarmPopoutRoute(route: PopoutRoute): void {
  void popoutPrewarmLoaders[route]();
}

export interface PopoutPageProps {
  activationKey: number;
  route: PopoutRoute;
  popout: PopoutApi;
}

const PopoutRouteLoading = ({
  quiet = false,
  route,
}: {
  quiet?: boolean;
  route: PopoutRoute;
}): ReactElement => (
  <div
    className={quiet ? 'popout-route-loading popout-route-loading--quiet' : 'popout-route-loading'}
    role="status"
    aria-live="polite"
    aria-label={`${getPopoutLabel(route)} ${LOADING_MESSAGES.ROUTE_LOADING}`}
  >
    {quiet ? (
      <div className="popout-route-loading__progress" aria-hidden="true">
        <span />
      </div>
    ) : (
      <>
        <div className="popout-route-loading__title">{getPopoutLabel(route)}</div>
        <div className="popout-route-loading__body">{LOADING_MESSAGES.ROUTE_LOADING}</div>
      </>
    )}
  </div>
);

export const PopoutPage = ({ activationKey, route, popout }: PopoutPageProps): ReactElement => {
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
      content = <AddAccountPopout key={`add-account:${activationKey}`} />;
      break;
    case 'add-watch-order':
      content = <AddWatchOrderPopout key={`add-watch-order:${activationKey}`} />;
      break;
    case 'settings':
      content = <SettingsPopout activationKey={activationKey} />;
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
      <Suspense fallback={<PopoutRouteLoading route={route} quiet={route === 'settings'} />}>
        {content}
      </Suspense>
    </div>
  );
};

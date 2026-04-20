import {
  AddWatchOrderDialog,
  type WatchOrderFormPrefill,
} from '@renderer/features/add-watch-order';
import { ProfitCalculatorPage } from '@renderer/features/profit-calculator';
import { AddAccountPage } from '@renderer/features/switch-account';
import { LogsPage } from '@renderer/pages/logs';
import { LotsLogPage } from '@renderer/pages/lots-log';
import { ReportsPage } from '@renderer/pages/reports';
import { SettingsPage } from '@renderer/pages/settings';
import { TradePage } from '@renderer/pages/trade';
import { StockPickerList } from '@renderer/widgets/stock-picker-list';
import { type ReactElement, useEffect, useState } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

/** localStorage key for add-watch-order popout prefill handoff. */
export const WATCH_ORDER_PREFILL_KEY = 'split-stock:add-watch-order-prefill';

export interface WatchOrderPrefillPayload {
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
}

/**
 * 자동감시 추가/수정 팝아웃 페이지.
 * watch-board 에서 localStorage 에 저장한 prefill 을 읽어 다이얼로그를 표시한다.
 * 저장 또는 취소 시 창을 닫는다.
 */
const AddWatchOrderPage = (): ReactElement => {
  const [payload, setPayload] = useState<WatchOrderPrefillPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_ORDER_PREFILL_KEY);
      if (raw) {
        localStorage.removeItem(WATCH_ORDER_PREFILL_KEY);
        const parsed = JSON.parse(raw) as WatchOrderPrefillPayload;
        setPayload(parsed);
      }
    } catch {
      // 파싱 실패 시 빈 신규 폼으로 진행
    }
    setOpen(true);
    setReady(true);
  }, []);

  const handleClose = (): void => {
    setOpen(false);
    window.close();
  };

  if (!ready) {
    return <div style={{ padding: '1rem' }}>로드 중…</div>;
  }

  return (
    <AddWatchOrderDialog
      open={open}
      accountId={payload?.accountId ?? 0}
      prefill={payload?.prefill ?? null}
      onClose={handleClose}
    />
  );
};

export interface PopoutPageProps {
  route: PopoutRoute;
  popout: PopoutApi;
}

export const PopoutPage = ({ route, popout }: PopoutPageProps): ReactElement => {
  return (
    <div style={{ padding: '1rem', height: '100vh', overflow: 'auto' }}>
      {route === 'trade' ? (
        <TradePage
          isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
          onOpenStockPickerPopout={() => popout.popout('stock-picker')}
        />
      ) : route === 'logs' ? (
        <LogsPage />
      ) : route === 'lots-log' ? (
        <div
          style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <LotsLogPage />
        </div>
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
      ) : route === 'add-account' ? (
        <AddAccountPage />
      ) : route === 'add-watch-order' ? (
        <AddWatchOrderPage />
      ) : (
        <SettingsPage />
      )}
    </div>
  );
};

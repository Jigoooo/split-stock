import { StockPickerList } from '@renderer/entities/stock';
import {
  AddWatchOrderDialog,
  type AddWatchOrderPrefillPayload,
  consumeAddWatchOrderPrefill,
} from '@renderer/features/add-watch-order';
import { ProfitCalculatorPage } from '@renderer/features/profit-calculator';
import { AddAccountPage } from '@renderer/features/switch-account';
import { LogsPage } from '@renderer/pages/logs';
import { ReportsPage } from '@renderer/pages/reports';
import { SettingsPage } from '@renderer/pages/settings';
import { TradePage } from '@renderer/pages/trade';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { getPopoutWindowTitle } from '@shared/popout';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

/**
 * 자동감시 추가/수정 팝아웃 페이지.
 * watch-board 에서 localStorage 에 저장한 prefill 을 읽어 다이얼로그를 표시한다.
 * 저장 또는 취소 시 창을 닫는다.
 */
const AddWatchOrderPage = (): ReactElement => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<AddWatchOrderPrefillPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const isEdit = payload?.prefill?.existingId !== undefined;

  useEffect(() => {
    try {
      const parsed = consumeAddWatchOrderPrefill();
      if (parsed) setPayload(parsed);
    } catch {
      // 파싱 실패 시 빈 신규 폼으로 진행
    }
    setOpen(true);
    setReady(true);
  }, []);

  useEffect(() => {
    document.title = isEdit ? 'Split Stock · 자동감시 수정' : 'Split Stock · 자동감시 추가';
  }, [isEdit]);

  useEffect(() => {
    const shell = window.appShell;
    const node = contentRef.current;
    if (!ready || !shell?.fitContentHeight || !node) return;

    let frameId = 0;
    let lastHeight = 0;
    const schedule = (): void => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        const nextHeight = Math.ceil(node.getBoundingClientRect().height);
        if (nextHeight <= 0 || nextHeight === lastHeight) return;
        lastHeight = nextHeight;
        void shell.fitContentHeight(nextHeight);
      });
    };

    schedule();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(node);
    window.addEventListener('resize', schedule);
    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ready]);

  const handleClose = (): void => {
    setOpen(false);
    window.close();
  };

  if (!ready) {
    return <div style={{ padding: '1rem' }}>{LOADING_MESSAGES.GENERAL}</div>;
  }

  return (
    <div ref={contentRef}>
      <AddWatchOrderDialog
        open={open}
        accountId={payload?.accountId ?? 0}
        prefill={payload?.prefill ?? null}
        layout="page"
        onClose={handleClose}
      />
    </div>
  );
};

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
      content = (
        <TradePage
          isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
          onOpenStockPickerPopout={() => popout.popout('stock-picker')}
        />
      );
      break;
    case 'logs':
      content = <LogsPage />;
      break;
    case 'reports':
      content = <ReportsPage />;
      break;
    case 'stock-picker':
      content = (
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
      break;
    case 'profit-calculator':
      content = <ProfitCalculatorPage />;
      break;
    case 'add-account':
      content = <AddAccountPage />;
      break;
    case 'add-watch-order':
      content = <AddWatchOrderPage />;
      break;
    case 'settings':
      content = <SettingsPage />;
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
      {content}
    </div>
  );
};

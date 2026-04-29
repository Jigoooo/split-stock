// @vitest-environment jsdom
import type { AutoOrderRetryEvent } from '@shared/contracts';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWatchEventNotifications } from './use-watch-event-notifications';

const {
  invalidateBalance,
  invalidateOverlay,
  invalidateCycles,
  invalidateTradeHistory,
  invalidateOrders,
  invalidateFills,
  invalidateWatchList,
  invalidateWatchControl,
  invalidateWatchHistory,
  toastFn,
  toastSuccess,
  toastError,
  toastWarning,
} = vi.hoisted(() => ({
  invalidateBalance: vi.fn().mockResolvedValue(undefined),
  invalidateOverlay: vi.fn().mockResolvedValue(undefined),
  invalidateCycles: vi.fn().mockResolvedValue(undefined),
  invalidateTradeHistory: vi.fn().mockResolvedValue(undefined),
  invalidateOrders: vi.fn().mockResolvedValue(undefined),
  invalidateFills: vi.fn().mockResolvedValue(undefined),
  invalidateWatchList: vi.fn().mockResolvedValue(undefined),
  invalidateWatchControl: vi.fn().mockResolvedValue(undefined),
  invalidateWatchHistory: vi.fn().mockResolvedValue(undefined),
  toastFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      account: {
        getBalanceWithLots: { invalidate: invalidateBalance },
        getPositionOverlay: { invalidate: invalidateOverlay },
      },
      lots: {
        cyclesByPdno: { invalidate: invalidateCycles },
        tradeHistory: { invalidate: invalidateTradeHistory },
      },
      order: {
        listActive: { invalidate: invalidateOrders },
        listMyFills: { invalidate: invalidateFills },
      },
      watch: {
        list: { invalidate: invalidateWatchList },
        getControlState: { invalidate: invalidateWatchControl },
        history: { invalidate: invalidateWatchHistory },
      },
    }),
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, {
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
  }),
}));

function HookHarness(): null {
  useWatchEventNotifications();
  return null;
}

describe('useWatchEventNotifications', () => {
  beforeEach(() => {
    invalidateBalance.mockReset();
    invalidateOverlay.mockReset();
    invalidateCycles.mockReset();
    invalidateTradeHistory.mockReset();
    invalidateOrders.mockReset();
    invalidateFills.mockReset();
    invalidateWatchList.mockReset();
    invalidateWatchControl.mockReset();
    invalidateWatchHistory.mockReset();
    toastFn.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastWarning.mockReset();
  });

  it('자동감시 추가 팝아웃이 닫히면 watch query 를 다시 불러온다', () => {
    let onPopoutClosed: ((route: string) => void) | undefined;

    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn((listener: (route: string) => void) => {
        onPopoutClosed = listener;
        return () => undefined;
      }),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => () => undefined),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => () => undefined),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => () => undefined),
      onWatchEvent: vi.fn(() => () => undefined),
      onAutoOrderRetryEvent: vi.fn(() => () => undefined),
      onTradeEvent: vi.fn(() => () => undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
    };

    render(<HookHarness />);
    onPopoutClosed?.('add-watch-order');

    expect(invalidateWatchList).toHaveBeenCalledTimes(1);
    expect(invalidateWatchControl).toHaveBeenCalledTimes(1);
    expect(invalidateWatchHistory).toHaveBeenCalledTimes(1);
    expect(invalidateBalance).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('다른 팝아웃 종료에는 반응하지 않는다', () => {
    let onPopoutClosed: ((route: string) => void) | undefined;

    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn((listener: (route: string) => void) => {
        onPopoutClosed = listener;
        return () => undefined;
      }),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => () => undefined),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => () => undefined),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => () => undefined),
      onWatchEvent: vi.fn(() => () => undefined),
      onAutoOrderRetryEvent: vi.fn(() => () => undefined),
      onTradeEvent: vi.fn(() => () => undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
    };

    render(<HookHarness />);
    onPopoutClosed?.('logs');

    expect(invalidateWatchList).not.toHaveBeenCalled();
    expect(invalidateWatchControl).not.toHaveBeenCalled();
    expect(invalidateWatchHistory).not.toHaveBeenCalled();
  });

  it('자동주문 재시도 예약 이벤트를 toast 로 노출한다', () => {
    let onAutoOrderRetryEvent: ((event: AutoOrderRetryEvent) => void) | undefined;

    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn(() => () => undefined),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => () => undefined),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => () => undefined),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => () => undefined),
      onWatchEvent: vi.fn(() => () => undefined),
      onAutoOrderRetryEvent: vi.fn((listener) => {
        onAutoOrderRetryEvent = listener;
        return () => undefined;
      }),
      onTradeEvent: vi.fn(() => () => undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
    };

    render(<HookHarness />);
    onAutoOrderRetryEvent?.({
      accountId: 1,
      failureType: 'FAILED',
      nth: 2,
      occurredAt: 1_799_999_999_000,
      pdno: '005930',
      price: 67_800,
      qty: 10,
      reason: '주문 실패: RATE_LIMITED',
      retryAfterMs: 3_000,
      side: 'BUY',
      triggerReason: 'DROP_BUY',
    });

    expect(toastWarning).toHaveBeenCalledWith(
      '자동매수 재시도 대기: 005930 · 2차 · 3초 후 재시도 · 주문 실패: RATE_LIMITED',
    );
  });
});

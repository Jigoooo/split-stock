// @vitest-environment jsdom
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
});

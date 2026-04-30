// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePopoutActivationKey, usePopoutVisibility } from './popout-window';

describe('popout window hooks', () => {
  let activatedListener: ((route: string, sequence: number) => void) | null = null;
  let visibilityListener: ((route: string, visible: boolean) => void) | null = null;

  beforeEach(() => {
    activatedListener = null;
    visibilityListener = null;
    window.location.hash = '#/popout/logs';
    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn(() => vi.fn()),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => vi.fn()),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => vi.fn()),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => vi.fn()),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
      onPopoutActivated: vi.fn((listener) => {
        activatedListener = listener;
        return vi.fn();
      }),
      onPopoutVisibilityChanged: vi.fn((listener) => {
        visibilityListener = listener;
        return vi.fn();
      }),
    };
  });

  it('main이 hidden 이벤트를 보내면 visibility를 false로 바꾼다', () => {
    const { result } = renderHook(() => usePopoutVisibility());

    act(() => {
      visibilityListener?.('logs', false);
    });

    expect(result.current).toBe(false);
  });

  it('activation 이벤트를 route별 key 증가로 노출한다', () => {
    const { result } = renderHook(() => usePopoutActivationKey('logs'));

    act(() => {
      activatedListener?.('settings', 1);
    });
    expect(result.current).toBe(0);

    act(() => {
      activatedListener?.('logs', 2);
    });
    expect(result.current).toBe(1);
  });
});

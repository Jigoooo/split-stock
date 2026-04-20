// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollbarInteraction } from './use-scrollbar-interaction';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeDiv(scrollTop = 0, scrollHeight = 500, clientHeight = 200) {
  const div = document.createElement('div');
  Object.defineProperty(div, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(div, 'scrollHeight', {
    value: scrollHeight,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(div, 'clientHeight', {
    value: clientHeight,
    writable: true,
    configurable: true,
  });
  document.body.appendChild(div);
  return div;
}

describe('useScrollbarInteraction', () => {
  it('초기 상태: isDragging=false, isVisible=false', () => {
    const div = makeDiv();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1500);
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.isVisible).toBe(false);
  });

  it('wheel 이벤트 발생 시 isVisible=true', () => {
    const div = makeDiv();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1500);
    });

    act(() => {
      div.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    expect(result.current.isVisible).toBe(true);
  });

  it('autoHideDelay 경과 후 isVisible=false', () => {
    const div = makeDiv();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1000);
    });

    act(() => {
      div.dispatchEvent(new Event('wheel', { bubbles: true }));
    });

    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(result.current.isVisible).toBe(false);
  });

  it('touchstart 이벤트로도 isVisible=true', () => {
    const div = makeDiv();
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1500);
    });

    act(() => {
      div.dispatchEvent(new Event('touchstart', { bubbles: true }));
    });

    expect(result.current.isVisible).toBe(true);
  });

  it('handleThumbPointerDown 호출 시 isDragging=true', () => {
    const div = makeDiv();
    div.setPointerCapture = vi.fn();

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1500);
    });

    act(() => {
      const fakeEvent = {
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        pointerId: 1,
        target: { setPointerCapture: vi.fn() },
      } as unknown as React.PointerEvent;

      result.current.handleThumbPointerDown(fakeEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.isVisible).toBe(true);
  });

  it('handleTrackPointerDown 호출 시 el.scrollTop 변경', () => {
    const div = makeDiv(0, 500, 200);
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div);
      return useScrollbarInteraction(ref, 40, 0, 1500);
    });

    const trackEl = document.createElement('div');
    vi.spyOn(trackEl, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 200,
      left: 0,
      right: 10,
      bottom: 200,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    act(() => {
      const fakeEvent = {
        clientY: 100,
        currentTarget: trackEl,
      } as unknown as React.PointerEvent;

      result.current.handleTrackPointerDown(fakeEvent);
    });

    // clickRatio = 100/200 = 0.5, maxScrollTop = 500-200 = 300, scrollTop = 0.5*300 = 150
    expect(div.scrollTop).toBe(150);
  });
});

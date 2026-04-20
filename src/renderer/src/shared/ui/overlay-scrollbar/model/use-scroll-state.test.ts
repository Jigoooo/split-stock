// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollState } from './use-scroll-state';

// requestAnimationFrame mock
let rafCallback: FrameRequestCallback | null = null;
const rafMock = vi.fn((cb: FrameRequestCallback) => {
  rafCallback = cb;
  return 1;
});
const cafMock = vi.fn(() => {
  rafCallback = null;
});

// ResizeObserver mock (jsdom에 없음) — class constructor 형태 필수
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', rafMock);
  vi.stubGlobal('cancelAnimationFrame', cafMock);
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  rafCallback = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushRaf() {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb(0);
  }
}

describe('useScrollState', () => {
  it('초기 스냅샷은 모두 0', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      return useScrollState(ref);
    });

    expect(result.current.scrollTop).toBe(0);
    expect(result.current.scrollHeight).toBe(0);
    expect(result.current.clientHeight).toBe(0);
  });

  it('containerRef가 마운트되면 scroll 이벤트에 응답', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'scrollTop', { value: 100, writable: true, configurable: true });
    Object.defineProperty(div, 'scrollHeight', { value: 500, writable: true, configurable: true });
    Object.defineProperty(div, 'clientHeight', { value: 200, writable: true, configurable: true });

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div as HTMLDivElement);
      return useScrollState(ref);
    });

    act(() => {
      flushRaf();
    });

    expect(result.current.scrollTop).toBe(100);
    expect(result.current.scrollHeight).toBe(500);
    expect(result.current.clientHeight).toBe(200);
  });

  it('scroll 이벤트 발생 시 스냅샷 업데이트', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(div, 'scrollHeight', { value: 400, writable: true, configurable: true });
    Object.defineProperty(div, 'clientHeight', { value: 200, writable: true, configurable: true });

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(div as HTMLDivElement);
      return useScrollState(ref);
    });

    act(() => {
      flushRaf();
    });

    // scrollTop 변경 후 scroll 이벤트
    act(() => {
      Object.defineProperty(div, 'scrollTop', { value: 50, writable: true, configurable: true });
      div.dispatchEvent(new Event('scroll'));
      flushRaf();
    });

    expect(result.current.scrollTop).toBe(50);
  });

  it('값이 변경되지 않으면 raf를 재실행하지 않음 (snapshotEquals 최적화)', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'scrollTop', { value: 10, writable: true, configurable: true });
    Object.defineProperty(div, 'scrollHeight', { value: 300, writable: true, configurable: true });
    Object.defineProperty(div, 'clientHeight', { value: 100, writable: true, configurable: true });

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(div as HTMLDivElement);
      return useScrollState(ref);
    });

    act(() => {
      flushRaf();
    });

    const rafCallsBefore = rafMock.mock.calls.length;

    // 동일한 값으로 scroll 이벤트 — raf 추가 호출 없어야 함
    act(() => {
      div.dispatchEvent(new Event('scroll'));
    });

    expect(rafMock.mock.calls.length).toBe(rafCallsBefore);
  });
});

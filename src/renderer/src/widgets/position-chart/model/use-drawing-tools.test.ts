// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drawing } from './drawing-types';
import { getDrawingStorageKey, useDrawingTools } from './use-drawing-tools';

/**
 * 테스트 전략
 *  - chart / series 는 최소 인터페이스만 목업 (createPriceLine / attachPrimitive / subscribeClick 등).
 *  - primitive 클래스는 import 되지 않음 — hook 이 attachPrimitive 에 인스턴스 전달만 하면 OK.
 *  - subscribeClick 핸들러는 ref 로 잡아 두고, 테스트에서 수동으로 invoke 해 interactive drawing 검증.
 */

interface MockChart {
  subscribeClick: ReturnType<typeof vi.fn>;
  unsubscribeClick: ReturnType<typeof vi.fn>;
  timeScale: () => { timeToCoordinate: (t: unknown) => number | null };
}

interface MockSeries {
  coordinateToPrice: (y: number) => number | null;
  priceToCoordinate: (price: number) => number | null;
  createPriceLine: ReturnType<typeof vi.fn>;
  removePriceLine: ReturnType<typeof vi.fn>;
  attachPrimitive: ReturnType<typeof vi.fn>;
  detachPrimitive: ReturnType<typeof vi.fn>;
}

const makeChart = (): {
  chart: MockChart;
  getClickHandler: () => ((param: unknown) => void) | null;
} => {
  let handler: ((param: unknown) => void) | null = null;
  const chart: MockChart = {
    subscribeClick: vi.fn((h: (param: unknown) => void) => {
      handler = h;
    }),
    unsubscribeClick: vi.fn(),
    timeScale: () => ({ timeToCoordinate: () => 0 }),
  };
  return { chart, getClickHandler: () => handler };
};

const makeSeries = (): MockSeries => ({
  coordinateToPrice: (y: number) => 10_000 - y, // y 30 → price 9970
  priceToCoordinate: (price: number) => 10_000 - price,
  createPriceLine: vi.fn((opts: { price: number }) => ({ __priceLine: opts.price })),
  removePriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
  detachPrimitive: vi.fn(),
});

describe('useDrawingTools', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('connectHost 후 저장된 드로잉을 복원해 series 에 attach 한다', async () => {
    const stored: Drawing[] = [
      { id: 'h-1', tool: 'HorizontalLine', price: 70000 },
      {
        id: 'r-1',
        tool: 'Rectangle',
        p1: { time: '2026-04-01', price: 70000 },
        p2: { time: '2026-04-15', price: 72000 },
      },
    ];
    window.localStorage.setItem(getDrawingStorageKey('005930'), JSON.stringify(stored));

    const { chart } = makeChart();
    const series = makeSeries();
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(series.createPriceLine).toHaveBeenCalledTimes(1);
    expect(series.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(chart.subscribeClick).toHaveBeenCalledTimes(1);
  });

  it('interactive TrendLine: 두 번 클릭 후 drawing 생성 + 영속화', async () => {
    const { chart, getClickHandler } = makeChart();
    const series = makeSeries();
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => {
      result.current.startDraw('TrendLine');
    });
    expect(result.current.activeTool).toBe('TrendLine');

    const handler = getClickHandler();
    expect(handler).not.toBeNull();
    act(() => {
      handler?.({ time: '2026-04-01', point: { x: 0, y: 30 } });
    });
    // 첫 클릭: 아직 1점, activeTool 유지
    expect(result.current.activeTool).toBe('TrendLine');

    act(() => {
      handler?.({ time: '2026-04-15', point: { x: 10, y: 20 } });
    });
    // 두 번째 클릭으로 완성 → primitive attach + 저장 + tool 해제
    expect(series.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(result.current.activeTool).toBeNull();

    const persisted = window.localStorage.getItem(getDrawingStorageKey('005930'));
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted ?? '[]') as Drawing[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.tool).toBe('TrendLine');
  });

  it('removeAll 은 모든 priceLine / primitive 를 detach 하고 localStorage 를 비운다', async () => {
    const stored: Drawing[] = [
      { id: 'h-1', tool: 'HorizontalLine', price: 70000 },
      { id: 'v-1', tool: 'VerticalLine', time: '2026-04-05' },
    ];
    window.localStorage.setItem(getDrawingStorageKey('005930'), JSON.stringify(stored));

    const { chart } = makeChart();
    const series = makeSeries();
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => {
      result.current.removeAll();
    });

    expect(series.removePriceLine).toHaveBeenCalledTimes(1);
    expect(series.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(getDrawingStorageKey('005930'))).toBeNull();
  });

  it('removeLast 는 가장 최근 드로잉만 제거한다', async () => {
    const stored: Drawing[] = [
      { id: 'h-1', tool: 'HorizontalLine', price: 70000 },
      { id: 'v-1', tool: 'VerticalLine', time: '2026-04-05' },
    ];
    window.localStorage.setItem(getDrawingStorageKey('005930'), JSON.stringify(stored));

    const { chart } = makeChart();
    const series = makeSeries();
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => {
      result.current.removeLast();
    });

    // VerticalLine(v-1) 이 마지막이므로 primitive detach 가 호출되어야 함
    expect(series.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(series.removePriceLine).not.toHaveBeenCalled();

    const persisted = window.localStorage.getItem(getDrawingStorageKey('005930'));
    const parsed = JSON.parse(persisted ?? '[]') as Drawing[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('h-1');
  });

  it('pdno 변경 시 이전 series primitive 를 detach 하고 새 pdno 저장본을 복원한다', async () => {
    window.localStorage.setItem(
      getDrawingStorageKey('005930'),
      JSON.stringify([{ id: 'h-a', tool: 'HorizontalLine', price: 70000 } satisfies Drawing]),
    );
    window.localStorage.setItem(
      getDrawingStorageKey('000660'),
      JSON.stringify([
        {
          id: 'r-b',
          tool: 'Rectangle',
          p1: { time: '2026-04-01', price: 80000 },
          p2: { time: '2026-04-15', price: 82000 },
        } satisfies Drawing,
      ]),
    );

    const { chart } = makeChart();
    const series = makeSeries();
    const { result, rerender } = renderHook(({ pdno }) => useDrawingTools(pdno), {
      initialProps: { pdno: '005930' },
    });

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(series.createPriceLine).toHaveBeenCalledTimes(1);

    rerender({ pdno: '000660' });

    await waitFor(() => expect(series.attachPrimitive).toHaveBeenCalledTimes(1));
    // 이전 pdno 의 HorizontalLine 은 detach (removePriceLine) 되어야 함
    expect(series.removePriceLine).toHaveBeenCalledTimes(1);
  });

  it('unmount 시 subscribeClick 구독을 해제한다', async () => {
    const { chart } = makeChart();
    const series = makeSeries();
    const { result, unmount } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost(chart as never, series as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    unmount();
    expect(chart.unsubscribeClick).toHaveBeenCalledTimes(1);
  });
});

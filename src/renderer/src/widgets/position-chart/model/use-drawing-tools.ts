import type { IChartApi, IPriceLine, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  RectanglePrimitive,
  TrendLinePrimitive,
  VerticalLinePrimitive,
} from './drawing-primitives';
import {
  type Drawing,
  type DrawingPoint,
  type DrawingToolKind,
  getDrawingStorageKey,
  POINTS_REQUIRED,
} from './drawing-types';

/**
 * 차트 드로잉 도구 훅 (자체구현 버전).
 *
 * 이전 외부 라이브러리(lightweight-charts-line-tools-*)는 제거됨 — plugin 이 chart
 * detach 시 GPU 리소스를 반납하지 않아 Electron IOSurface 가 고갈되며 UI 가 멈추는
 * 회귀가 있었다. 자체 primitive 는 chart/series 외부 참조를 들지 않아 chart.remove
 * 시 정상적으로 GC 되고, `unsafe-cancel` 경로 없이도 상태가 잘 정리된다.
 *
 * 지원 tool:
 *  - HorizontalLine: series.createPriceLine (lightweight-charts built-in)
 *  - VerticalLine / TrendLine / Rectangle: 자체 ISeriesPrimitive
 *
 * 인터랙티브 플로우:
 *  1. 사용자 툴바 버튼 클릭 → `startDraw(tool)` 호출 → pendingTool 상태.
 *  2. 차트 클릭 → `handleChartClick` 가 MouseEventParams 로부터 time/price 수집.
 *  3. 필요 포인트 수(1 또는 2) 채워지면 Drawing 생성 + 영속화 + 렌더 attach.
 */

const randomId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const readPersisted = (pdno: string): Drawing[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getDrawingStorageKey(pdno));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
};

const persist = (pdno: string, drawings: Drawing[]): void => {
  if (typeof window === 'undefined') return;
  try {
    if (drawings.length === 0) {
      window.localStorage.removeItem(getDrawingStorageKey(pdno));
      return;
    }
    window.localStorage.setItem(getDrawingStorageKey(pdno), JSON.stringify(drawings));
  } catch {
    // quota / privacy mode 는 치명적이지 않으므로 삼킨다.
  }
};

type PrimitiveInstance = TrendLinePrimitive | RectanglePrimitive | VerticalLinePrimitive;

interface AttachedHandles {
  /** priceLines — HorizontalLine id → IPriceLine 핸들. */
  priceLines: Map<string, IPriceLine>;
  /** primitives — 기타 id → ISeriesPrimitive 인스턴스. */
  primitives: Map<string, PrimitiveInstance>;
}

const emptyHandles = (): AttachedHandles => ({
  priceLines: new Map(),
  primitives: new Map(),
});

const attachDrawing = (
  series: ISeriesApi<'Candlestick'>,
  drawing: Drawing,
  handles: AttachedHandles,
): void => {
  switch (drawing.tool) {
    case 'HorizontalLine': {
      const line = series.createPriceLine({
        price: drawing.price,
        color: '#1f2937',
        lineWidth: 1,
        axisLabelVisible: true,
        title: '',
      });
      handles.priceLines.set(drawing.id, line);
      return;
    }
    case 'VerticalLine': {
      const prim = new VerticalLinePrimitive(drawing.time);
      series.attachPrimitive(prim);
      handles.primitives.set(drawing.id, prim);
      return;
    }
    case 'TrendLine': {
      const prim = new TrendLinePrimitive(drawing.p1, drawing.p2);
      series.attachPrimitive(prim);
      handles.primitives.set(drawing.id, prim);
      return;
    }
    case 'Rectangle': {
      const prim = new RectanglePrimitive(drawing.p1, drawing.p2);
      series.attachPrimitive(prim);
      handles.primitives.set(drawing.id, prim);
      return;
    }
  }
};

const detachAll = (series: ISeriesApi<'Candlestick'> | null, handles: AttachedHandles): void => {
  if (!series) {
    handles.priceLines.clear();
    handles.primitives.clear();
    return;
  }
  for (const line of handles.priceLines.values()) {
    try {
      series.removePriceLine(line);
    } catch {
      // series 가 이미 destroy 된 경우 무시
    }
  }
  for (const prim of handles.primitives.values()) {
    try {
      series.detachPrimitive(prim);
    } catch {
      // 동일
    }
  }
  handles.priceLines.clear();
  handles.primitives.clear();
};

const toPointFromEvent = (
  param: MouseEventParams<Time>,
  series: ISeriesApi<'Candlestick'>,
): DrawingPoint | null => {
  if (!param.time || !param.point) return null;
  const price = series.coordinateToPrice(param.point.y);
  if (price === null || !Number.isFinite(price)) return null;
  return { time: String(param.time), price };
};

const buildDrawing = (tool: DrawingToolKind, points: DrawingPoint[]): Drawing | null => {
  const id = randomId();
  const first = points[0];
  const second = points[1];
  if (!first) return null;
  switch (tool) {
    case 'HorizontalLine':
      return { id, tool, price: first.price };
    case 'VerticalLine':
      return { id, tool, time: first.time };
    case 'TrendLine':
      if (!second) return null;
      return { id, tool, p1: first, p2: second };
    case 'Rectangle':
      if (!second) return null;
      return { id, tool, p1: first, p2: second };
  }
};

export interface UseDrawingToolsResult {
  activeTool: DrawingToolKind | null;
  connectHost: (chart: IChartApi, series: ISeriesApi<'Candlestick'>) => void;
  disconnectHost: () => void;
  isReady: boolean;
  removeAll: () => void;
  removeLast: () => void;
  startDraw: (tool: DrawingToolKind) => void;
}

export function useDrawingTools(pdno: string): UseDrawingToolsResult {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const handlesRef = useRef<AttachedHandles>(emptyHandles());
  const pendingToolRef = useRef<DrawingToolKind | null>(null);
  const pendingPointsRef = useRef<DrawingPoint[]>([]);
  const clickHandlerRef = useRef<((param: MouseEventParams<Time>) => void) | null>(null);
  const pdnoRef = useRef(pdno);
  pdnoRef.current = pdno;

  const [activeTool, setActiveTool] = useState<DrawingToolKind | null>(null);
  const [isReady, setIsReady] = useState(false);

  const clearPending = (): void => {
    pendingToolRef.current = null;
    pendingPointsRef.current = [];
    setActiveTool(null);
  };

  const handleClick = useEffectEvent((param: MouseEventParams<Time>) => {
    const tool = pendingToolRef.current;
    const series = seriesRef.current;
    if (!tool || !series) return;
    const point = toPointFromEvent(param, series);
    if (!point) return;

    pendingPointsRef.current = [...pendingPointsRef.current, point];
    const required = POINTS_REQUIRED[tool];
    if (pendingPointsRef.current.length < required) return;

    const drawing = buildDrawing(tool, pendingPointsRef.current);
    if (drawing) {
      drawingsRef.current = [...drawingsRef.current, drawing];
      attachDrawing(series, drawing, handlesRef.current);
      persist(pdnoRef.current, drawingsRef.current);
    }
    clearPending();
  });

  const connectHost = useEffectEvent((chart: IChartApi, series: ISeriesApi<'Candlestick'>) => {
    if (chartRef.current === chart && seriesRef.current === series && isReady) return;

    // 동일 series 의 재연결일 수 있으므로 이전 구독을 먼저 정리.
    const prevChart = chartRef.current;
    const prevHandler = clickHandlerRef.current;
    if (prevChart && prevHandler) {
      try {
        prevChart.unsubscribeClick(prevHandler);
      } catch {
        // ignore
      }
    }
    detachAll(seriesRef.current, handlesRef.current);

    chartRef.current = chart;
    seriesRef.current = series;

    drawingsRef.current = readPersisted(pdnoRef.current);
    for (const drawing of drawingsRef.current) {
      attachDrawing(series, drawing, handlesRef.current);
    }

    const handler = (param: MouseEventParams<Time>): void => handleClick(param);
    clickHandlerRef.current = handler;
    chart.subscribeClick(handler);

    setIsReady(true);
    setActiveTool(null);
  });

  const disconnectHost = useEffectEvent(() => {
    const chart = chartRef.current;
    const handler = clickHandlerRef.current;
    if (chart && handler) {
      try {
        chart.unsubscribeClick(handler);
      } catch {
        // ignore
      }
    }
    detachAll(seriesRef.current, handlesRef.current);
    chartRef.current = null;
    seriesRef.current = null;
    clickHandlerRef.current = null;
    clearPending();
    setIsReady(false);
    // drawingsRef 는 비우지 않는다 — pdno 가 바뀌지 않는 한 다음 connectHost 에서
    // 그대로 재사용. localStorage 도 그대로 유지(현재 값이 최신).
  });

  // pdno 변경 → 이전 pdno 저장분은 이미 localStorage 에 있음. 새 pdno 로 리로드.
  const applyPdnoSwap = useEffectEvent((nextPdno: string) => {
    const series = seriesRef.current;
    if (!series) {
      drawingsRef.current = [];
      return;
    }
    detachAll(series, handlesRef.current);
    drawingsRef.current = readPersisted(nextPdno);
    for (const drawing of drawingsRef.current) {
      attachDrawing(series, drawing, handlesRef.current);
    }
    clearPending();
  });

  useEffect(() => {
    applyPdnoSwap(pdno);
  }, [pdno]);

  // 컴포넌트 unmount 시 chart 리소스 정리 — 자체 primitive 라 GPU 리소스 누수 없음.
  useEffect(() => {
    return () => {
      disconnectHost();
    };
  }, []);

  const startDraw = (tool: DrawingToolKind): void => {
    if (!seriesRef.current) return;
    pendingToolRef.current = tool;
    pendingPointsRef.current = [];
    setActiveTool(tool);
  };

  const removeAll = (): void => {
    const series = seriesRef.current;
    detachAll(series, handlesRef.current);
    drawingsRef.current = [];
    persist(pdnoRef.current, []);
    clearPending();
  };

  const removeLast = (): void => {
    const series = seriesRef.current;
    if (drawingsRef.current.length === 0) return;
    const last = drawingsRef.current[drawingsRef.current.length - 1];
    if (!last) return;
    if (series) {
      if (last.tool === 'HorizontalLine') {
        const line = handlesRef.current.priceLines.get(last.id);
        if (line) {
          try {
            series.removePriceLine(line);
          } catch {
            // ignore
          }
        }
        handlesRef.current.priceLines.delete(last.id);
      } else {
        const prim = handlesRef.current.primitives.get(last.id);
        if (prim) {
          try {
            series.detachPrimitive(prim);
          } catch {
            // ignore
          }
        }
        handlesRef.current.primitives.delete(last.id);
      }
    }
    drawingsRef.current = drawingsRef.current.slice(0, -1);
    persist(pdnoRef.current, drawingsRef.current);
    clearPending();
  };

  return {
    activeTool,
    connectHost,
    disconnectHost,
    isReady,
    removeAll,
    removeLast,
    startDraw,
  };
}

export { getDrawingStorageKey } from './drawing-types';

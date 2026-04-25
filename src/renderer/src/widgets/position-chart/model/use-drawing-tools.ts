import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AttachedHandles,
  attachDrawing,
  detachAll,
  emptyHandles,
} from '../lib/drawing-attach';
import { buildDrawing, toPointFromEvent } from '../lib/drawing-points';
import { persist, readPersisted } from '../lib/drawing-storage';
import {
  type Drawing,
  type DrawingPoint,
  type DrawingToolKind,
  POINTS_REQUIRED,
} from './drawing-types';

/**
 * 차트 드로잉 도구 훅 (자체구현 버전).
 *
 * 이전 외부 라이브러리(lightweight-charts-line-tools-*)는 제거됨 — plugin 이 chart
 * detach 시 GPU 리소스를 반납하지 않아 Electron IOSurface 가 고갈되며 UI 가 멈추는
 * 회귀가 있었다. 자체 primitive 는 chart/series 외부 참조를 들지 않아 chart.remove
 * 시 정상적으로 GC 된다.
 *
 * 지원 tool:
 *  - HorizontalLine: series.createPriceLine (lightweight-charts built-in)
 *  - VerticalLine / TrendLine / Rectangle: 자체 ISeriesPrimitive
 *
 * 인터랙티브 플로우:
 *  1. 사용자 툴바 버튼 클릭 → `startDraw(tool)` 호출 → pendingTool 상태.
 *  2. 차트 클릭 → chart.subscribeClick 핸들러가 time/price 를 수집.
 *  3. 필요 포인트 수(1 또는 2) 채워지면 Drawing 생성 + 영속화 + 렌더 attach.
 *
 * 클릭 핸들러는 useEffectEvent 대신 "latest-ref" 패턴으로 잡는다. React 19 에서
 * useEffectEvent 는 effect 안에서만 호출하도록 설계돼 있어 외부 라이브러리
 * (subscribeClick) 콜백에서는 경고를 띄우거나 동작이 불안정할 수 있다.
 *
 * 순수 helper / attach 로직은 lib/drawing-{storage,points,attach}.ts 로 분리되어
 * 있고, 이 hook 은 chart/series 수명주기와 인터랙션 상태만 다룬다.
 */
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

  /**
   * 클릭 핸들러는 매 렌더마다 최신 로직으로 덮어쓰는 ref — chart.subscribeClick 에는
   * 한 번만 등록된 "얇은 wrapper" 가 들어가고, 내부에서 최신 ref 를 호출해 항상 최신
   * state/props 를 본다.  useEffectEvent 는 외부 라이브러리 콜백에서 호출할 때 경고를
   * 띄울 수 있어 피한다.
   */
  const dispatchClickRef = useRef<(param: MouseEventParams<Time>) => void>(() => {});
  dispatchClickRef.current = (param: MouseEventParams<Time>): void => {
    const tool = pendingToolRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!tool || !series || !chart) return;
    const point = toPointFromEvent(param, chart, series);
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
  };

  // connectHost / disconnectHost 는 candlestick-chart 의 useEffect 안에서 호출된다.
  // 재렌더 때마다 새 reference 가 반환되면 해당 useEffect dep 가 바뀌어 chart 생성 effect
  // cleanup → chart.remove → seriesRef 초기화 → isFirstLoad=true → setVisibleLogicalRange
  // 무한 루프(좌측 스크롤 덜덜 떨림)가 발생하므로 identity 안정성이 필수.
  //
  // 이전엔 useEffectEvent 로 감쌌으나 React 19 + React Compiler 환경에서
  // identity 가 매 렌더마다 바뀌는 회귀를 관측 → 프로젝트 내 dispatchClickRef 와 동일한
  // "latest-ref + useCallback([])" 패턴으로 일원화해 마운트 수명 동안 동일 reference 보장.
  const connectHostFnRef = useRef<(chart: IChartApi, series: ISeriesApi<'Candlestick'>) => void>(
    () => {},
  );
  connectHostFnRef.current = (chart: IChartApi, series: ISeriesApi<'Candlestick'>): void => {
    if (chartRef.current === chart && seriesRef.current === series && isReady) return;

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

    const handler = (param: MouseEventParams<Time>): void => dispatchClickRef.current(param);
    clickHandlerRef.current = handler;
    chart.subscribeClick(handler);

    setIsReady(true);
    setActiveTool(null);
  };
  const connectHost = useCallback(
    (chart: IChartApi, series: ISeriesApi<'Candlestick'>): void =>
      connectHostFnRef.current(chart, series),
    [],
  );

  const disconnectHostFnRef = useRef<() => void>(() => {});
  disconnectHostFnRef.current = (): void => {
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
    pendingToolRef.current = null;
    pendingPointsRef.current = [];
    setActiveTool(null);
    setIsReady(false);
  };
  const disconnectHost = useCallback((): void => disconnectHostFnRef.current(), []);

  // pdno 변경 → 이전 pdno 저장분은 이미 localStorage 에 있음. 새 pdno 로 리로드.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) {
      drawingsRef.current = [];
      return;
    }
    detachAll(series, handlesRef.current);
    drawingsRef.current = readPersisted(pdno);
    for (const drawing of drawingsRef.current) {
      attachDrawing(series, drawing, handlesRef.current);
    }
    pendingToolRef.current = null;
    pendingPointsRef.current = [];
    setActiveTool(null);
  }, [pdno]);

  // 컴포넌트 unmount 시 chart 리소스 정리 — 자체 primitive 라 GPU 리소스 누수 없음.
  useEffect(() => {
    return () => {
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
    };
  }, []);

  const startDraw = (tool: DrawingToolKind): void => {
    // series 가 아직 없어도 활성 상태는 즉시 반영 — 사용자 입장에서 버튼이 "먹지도"
    // 않는 듯 보이는 것을 피한다. chart 준비 이후의 첫 클릭이 포인트 수집을 시작한다.
    pendingToolRef.current = tool;
    pendingPointsRef.current = [];
    setActiveTool(tool);
  };

  const removeAll = (): void => {
    const series = seriesRef.current;
    detachAll(series, handlesRef.current);
    drawingsRef.current = [];
    persist(pdnoRef.current, []);
    pendingToolRef.current = null;
    pendingPointsRef.current = [];
    setActiveTool(null);
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
    pendingToolRef.current = null;
    pendingPointsRef.current = [];
    setActiveTool(null);
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

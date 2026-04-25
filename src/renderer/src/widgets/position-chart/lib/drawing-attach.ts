import type { IPriceLine, ISeriesApi } from 'lightweight-charts';
import {
  RectanglePrimitive,
  TrendLinePrimitive,
  VerticalLinePrimitive,
} from '../model/drawing-primitives';
import type { Drawing } from '../model/drawing-types';

export type PrimitiveInstance = TrendLinePrimitive | RectanglePrimitive | VerticalLinePrimitive;

export interface AttachedHandles {
  /** priceLines — HorizontalLine id → IPriceLine 핸들. */
  priceLines: Map<string, IPriceLine>;
  /** primitives — 기타 id → ISeriesPrimitive 인스턴스. */
  primitives: Map<string, PrimitiveInstance>;
}

export const emptyHandles = (): AttachedHandles => ({
  priceLines: new Map(),
  primitives: new Map(),
});

export const attachDrawing = (
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

export const detachAll = (
  series: ISeriesApi<'Candlestick'> | null,
  handles: AttachedHandles,
): void => {
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

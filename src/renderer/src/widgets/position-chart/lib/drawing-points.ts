import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import type { Drawing, DrawingPoint, DrawingToolKind } from '../model/drawing-types';
import { randomId } from './drawing-storage';

/**
 * MouseEventParams → DrawingPoint.
 * - param.time 이 set 이면 바로 사용 (클릭이 데이터 범위 안).
 * - param.time 이 undefined 면 coordinateToTime 으로 대체 (데이터 범위 밖 클릭 허용).
 * - coordinateToTime 도 null 이면 point 생성 불가 → null 반환.
 */
export const toPointFromEvent = (
  param: MouseEventParams<Time>,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
): DrawingPoint | null => {
  if (!param.point) return null;
  let time: Time | undefined = param.time;
  if (!time) {
    const fallback = chart.timeScale().coordinateToTime(param.point.x);
    if (fallback !== null) time = fallback as Time;
  }
  if (!time) return null;
  const price = series.coordinateToPrice(param.point.y);
  if (price === null || !Number.isFinite(price)) return null;
  return { time: String(time), price };
};

export const buildDrawing = (tool: DrawingToolKind, points: DrawingPoint[]): Drawing | null => {
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

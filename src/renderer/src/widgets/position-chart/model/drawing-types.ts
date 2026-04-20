/**
 * 차트 드로잉 공통 타입.
 *
 * 4종 드로잉:
 *  - HorizontalLine: 단일 가격. series.createPriceLine 재사용 (lightweight-charts built-in).
 *  - VerticalLine:   단일 시간(YYYY-MM-DD). 자체 IPanePrimitive 로 렌더.
 *  - TrendLine:      두 점. 자체 ISeriesPrimitive 로 렌더.
 *  - Rectangle:      두 점. 자체 ISeriesPrimitive 로 렌더.
 *
 * 이전 외부 라이브러리(lightweight-charts-line-tools-*)는 제거됨 — plugin 이
 * chart detach 시 GPU 리소스를 해제하지 않아 Electron IOSurface 가 고갈되며
 * "GPU state invalid" 로 UI 가 멈추는 회귀가 있었다.
 */

export type DrawingToolKind = 'TrendLine' | 'HorizontalLine' | 'VerticalLine' | 'Rectangle';

export interface DrawingPoint {
  /** bar time — setData 에 넘기는 string(YYYY-MM-DD) 과 동일한 형식. */
  time: string;
  price: number;
}

export type Drawing =
  | { id: string; tool: 'HorizontalLine'; price: number }
  | { id: string; tool: 'VerticalLine'; time: string }
  | { id: string; tool: 'TrendLine'; p1: DrawingPoint; p2: DrawingPoint }
  | { id: string; tool: 'Rectangle'; p1: DrawingPoint; p2: DrawingPoint };

/** 한 tool 을 완성하는 데 필요한 click 수. */
export const POINTS_REQUIRED: Record<DrawingToolKind, 1 | 2> = {
  HorizontalLine: 1,
  VerticalLine: 1,
  TrendLine: 2,
  Rectangle: 2,
};

export const DRAWING_STORAGE_PREFIX = 'split-stock.chart.drawings.';

export const getDrawingStorageKey = (pdno: string): string => `${DRAWING_STORAGE_PREFIX}${pdno}`;

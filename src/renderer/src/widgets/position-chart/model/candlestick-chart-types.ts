import type { MaPeriod } from '@renderer/entities/display-settings';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';

export type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;

export interface CandlestickChartRefs {
  chartRef: RefObject<IChartApi | null>;
  maSeriesRef: RefObject<Partial<Record<MaPeriod, ISeriesApi<'Line'>>>>;
  prevLengthRef: RefObject<number>;
  priceLinesRef: RefObject<PriceLineHandle[]>;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  volumeSeriesRef: RefObject<ISeriesApi<'Histogram'> | null>;
}

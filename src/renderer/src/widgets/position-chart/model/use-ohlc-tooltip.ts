import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  SeriesDataItemTypeMap,
  Time,
} from 'lightweight-charts';
import { type RefObject, useEffect, useRef, useState } from 'react';
import type { Candle } from './use-position-chart';

export interface OhlcTooltipPayload {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number | null;
}

export interface OhlcTooltipState {
  visible: boolean;
  point: { x: number; y: number } | null;
  payload: OhlcTooltipPayload | null;
}

interface UseOhlcTooltipParams {
  candles: Candle[];
  chartRef: RefObject<IChartApi | null>;
  liveCandle: Candle | null;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  volumeSeriesRef: RefObject<ISeriesApi<'Histogram'> | null>;
}

const HIDDEN: OhlcTooltipState = { visible: false, point: null, payload: null };

function isBarLike(
  value: unknown,
): value is { open: number; high: number; low: number; close: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.open === 'number' &&
    typeof v.high === 'number' &&
    typeof v.low === 'number' &&
    typeof v.close === 'number'
  );
}

function findPrevClose(candles: readonly Candle[], targetDate: string): number | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (candle && candle.date < targetDate) return candle.close;
  }
  return null;
}

function findVolume(
  candles: readonly Candle[],
  liveCandle: Candle | null,
  targetDate: string,
): number {
  if (liveCandle && liveCandle.date === targetDate) return liveCandle.volume;
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (candle && candle.date === targetDate) return candle.volume;
  }
  return 0;
}

export function useOhlcTooltip({
  candles,
  chartRef,
  liveCandle,
  seriesRef,
  volumeSeriesRef,
}: UseOhlcTooltipParams): OhlcTooltipState {
  const [state, setState] = useState<OhlcTooltipState>(HIDDEN);
  const candlesRef = useRef(candles);
  const liveCandleRef = useRef(liveCandle);
  candlesRef.current = candles;
  liveCandleRef.current = liveCandle;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: MouseEventParams<Time>): void => {
      const point = param.point;
      const time = param.time;
      const series = seriesRef.current;
      if (!point || time === undefined || !series) {
        setState(HIDDEN);
        return;
      }

      const bar = param.seriesData.get(series);
      if (!isBarLike(bar)) {
        setState(HIDDEN);
        return;
      }

      const dateKey = String(time);
      const volumeSeries = volumeSeriesRef.current;
      let volume = 0;
      if (volumeSeries) {
        const vol = param.seriesData.get(volumeSeries) as
          | SeriesDataItemTypeMap['Histogram']
          | undefined;
        if (vol && 'value' in vol && typeof vol.value === 'number') {
          volume = vol.value;
        }
      }
      if (volume === 0) {
        volume = findVolume(candlesRef.current, liveCandleRef.current, dateKey);
      }

      setState({
        visible: true,
        point: { x: point.x, y: point.y },
        payload: {
          date: dateKey,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume,
          prevClose: findPrevClose(candlesRef.current, dateKey),
        },
      });
    };

    chart.subscribeCrosshairMove(handler);
    return () => {
      try {
        chart.unsubscribeCrosshairMove(handler);
      } catch {
        // chart 가 이미 제거된 경우 무시 (use-chart-instance cleanup 순서 의존).
      }
    };
  }, [chartRef, seriesRef, volumeSeriesRef]);

  return state;
}

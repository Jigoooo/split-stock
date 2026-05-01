import type { DisplaySettings } from '@renderer/entities/display-settings';
import { useEffect } from 'react';
import { candleDateToTime } from '../lib/candlestick-chart-format';
import type { CandlestickChartRefs } from './candlestick-chart-types';
import type { Candle } from './use-position-chart';

interface UseLiveCandleSeriesParams
  extends Pick<CandlestickChartRefs, 'seriesRef' | 'volumeSeriesRef'> {
  displaySettings: DisplaySettings | null | undefined;
  liveCandle: Candle | null;
}

export function useLiveCandleSeries({
  displaySettings,
  liveCandle,
  seriesRef,
  volumeSeriesRef,
}: UseLiveCandleSeriesParams): void {
  useEffect(() => {
    if (!liveCandle) return;
    const series = seriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!series) return;

    series.update({
      time: candleDateToTime(liveCandle.date),
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });

    if (volumeSeries) {
      const upColor = displaySettings?.chart.volume.upColor ?? 'rgba(220,38,38,0.5)';
      const downColor = displaySettings?.chart.volume.downColor ?? 'rgba(37,99,235,0.5)';
      volumeSeries.update({
        time: candleDateToTime(liveCandle.date),
        value: liveCandle.volume,
        color: liveCandle.close >= liveCandle.open ? upColor : downColor,
      });
    }
  }, [displaySettings, liveCandle, seriesRef, volumeSeriesRef]);
}

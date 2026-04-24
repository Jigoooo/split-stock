import type { DisplaySettings } from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import {
  type CandlestickData,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { useEffect } from 'react';
import {
  DEFAULT_VISIBLE_BARS,
  HISTORY_FETCH_TRIGGER_BARS,
} from '../config/candlestick-chart-config';
import { computeMa, LINE_STYLE_MAP, MA_PERIODS_CONST } from '../lib/candlestick-chart-format';
import type { CandlestickChartRefs } from './candlestick-chart-types';
import type { Candle } from './use-position-chart';

interface UseCandlestickDataParams extends CandlestickChartRefs {
  candles: Candle[];
  connectDrawingHost: CandlestickChartRefs['chartRef']['current'] extends infer Chart
    ? (
        chart: NonNullable<Chart>,
        series: NonNullable<CandlestickChartRefs['seriesRef']['current']>,
      ) => void
    : never;
  disconnectDrawingHost: () => void;
  displaySettings: DisplaySettings | null | undefined;
  enableDrawingTools: boolean;
}

export function useCandlestickData({
  candles,
  chartRef,
  connectDrawingHost,
  disconnectDrawingHost,
  displaySettings,
  enableDrawingTools,
  maSeriesRef,
  prevLengthRef,
  priceLinesRef,
  seriesRef,
  volumeSeriesRef,
}: UseCandlestickDataParams): void {
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (candles.length === 0) {
      seriesRef.current?.setData([]);
      volumeSeriesRef.current?.setData([]);
      for (const period of MA_PERIODS_CONST) {
        maSeriesRef.current[period]?.setData([]);
      }
      for (const priceLine of priceLinesRef.current) {
        seriesRef.current?.removePriceLine(priceLine);
      }
      priceLinesRef.current = [];
      prevLengthRef.current = 0;
      return;
    }

    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const isFirstLoad = seriesRef.current === null || prevLengthRef.current === 0;
    const volumeSettings = displaySettings?.chart.volume;
    const heightPercent = volumeSettings?.heightPercent ?? 30;
    const volumeBottom = heightPercent / 100;

    let series = seriesRef.current;
    if (!series) {
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#d73333',
        downColor: '#2d4fca',
        wickUpColor: '#d73333',
        wickDownColor: '#2d4fca',
        borderVisible: false,
        priceScaleId: 'right',
        priceFormat: {
          type: 'custom',
          formatter: (price: number): string =>
            thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
        },
      });
      seriesRef.current = series;
    }

    series.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: volumeBottom + 0.02 },
    });

    const data: CandlestickData[] = candles.map((candle) => ({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    series.setData(data);

    const upColor = volumeSettings?.upColor ?? 'rgba(220,38,38,0.5)';
    const downColor = volumeSettings?.downColor ?? 'rgba(37,99,235,0.5)';
    let volumeSeries = volumeSeriesRef.current;
    if (!volumeSeries) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumeSeriesRef.current = volumeSeries;
    }

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 1 - volumeBottom, bottom: 0 },
    });
    volumeSeries.setData(
      candles.map((candle) => ({
        time: candle.date,
        value: candle.volume,
        color: candle.close >= candle.open ? upColor : downColor,
      })),
    );

    for (const period of MA_PERIODS_CONST) {
      const maSettings = displaySettings?.chart.ma[period];
      const enabled = maSettings?.enabled ?? period <= 20;
      const color = maSettings?.color ?? '#888888';
      const width = maSettings?.width ?? 1;
      const style = maSettings?.style ?? 'solid';
      let maSeries = maSeriesRef.current[period];

      if (!enabled) {
        if (maSeries) {
          chart.removeSeries(maSeries);
          delete maSeriesRef.current[period];
        }
        continue;
      }

      if (!maSeries) {
        maSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          lineStyle: LINE_STYLE_MAP[style] ?? LINE_STYLE_MAP.solid,
          priceScaleId: 'right',
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: {
            type: 'custom',
            formatter: (price: number): string =>
              thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
          },
        });
        maSeriesRef.current[period] = maSeries;
      } else {
        maSeries.applyOptions({
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          lineStyle: LINE_STYLE_MAP[style] ?? LINE_STYLE_MAP.solid,
        });
      }

      maSeries.setData(computeMa(candles, period));
    }

    if (enableDrawingTools) {
      connectDrawingHost(chart, series);
    } else {
      disconnectDrawingHost();
    }

    if (isFirstLoad || !prevRange) {
      const total = data.length;
      const shown = Math.min(DEFAULT_VISIBLE_BARS, total);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, total - shown),
        to: total - 1,
      });
    } else {
      const added = data.length - prevLengthRef.current;
      if (added > 0 && prevRange.from > HISTORY_FETCH_TRIGGER_BARS) {
        chart.timeScale().setVisibleLogicalRange({
          from: prevRange.from + added,
          to: prevRange.to + added,
        });
      }
    }

    prevLengthRef.current = data.length;
  }, [
    candles,
    chartRef,
    connectDrawingHost,
    disconnectDrawingHost,
    displaySettings,
    enableDrawingTools,
    maSeriesRef,
    prevLengthRef,
    priceLinesRef,
    seriesRef,
    volumeSeriesRef,
  ]);
}

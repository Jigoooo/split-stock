import { thousandSeparator } from '@renderer/shared/lib/formatter';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
} from 'lightweight-charts';
import { type ReactElement, useEffect, useEffectEvent, useRef } from 'react';
import type { Candle } from '../model/use-position-chart';

type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;

export interface CandlestickChartProps {
  candles: Candle[];
  lines: Array<{ kind: 'buy' | 'sell-target'; label: string; price: number }>;
  onFetchMore: () => Promise<void>;
  reachedEnd: boolean;
}

export const CandlestickChart = ({
  candles,
  lines,
  onFetchMore,
  reachedEnd,
}: CandlestickChartProps): ReactElement => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceLinesRef = useRef<PriceLineHandle[]>([]);
  const prevLengthRef = useRef(0);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const onFetchMoreEvent = useEffectEvent(onFetchMore);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight || 340,
      layout: { background: { color: '#ffffff' }, textColor: '#222' },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: { borderColor: '#cccccc' },
      timeScale: { borderColor: '#cccccc' },
      localization: {
        priceFormatter: (price: number): string =>
          thousandSeparator(price, { allowNegative: true, allowDecimal: true }),
      },
    });
    chartRef.current = chart;

    const handleResize = (): void => {
      chart.applyOptions({ width: element.clientWidth, height: element.clientHeight || 340 });
    };

    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(handleResize);
    observer.observe(element);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      priceLinesRef.current = [];
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onRangeChange = (range: { from: number; to: number } | null): void => {
      if (!range || reachedEnd) return;
      if (range.from > 50) return;
      void onFetchMoreEvent();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
    };
  }, [reachedEnd]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (candles.length === 0) {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
      priceLinesRef.current = [];
      prevLengthRef.current = 0;
      return;
    }

    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const isFirstLoad = seriesRef.current === null;

    let series = seriesRef.current;
    if (!series) {
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#d73333',
        downColor: '#2d4fca',
        wickUpColor: '#d73333',
        wickDownColor: '#2d4fca',
        borderVisible: false,
        priceFormat: {
          type: 'custom',
          formatter: (price: number): string =>
            thousandSeparator(price, { allowNegative: true, allowDecimal: true }),
        },
      });
      seriesRef.current = series;
    }

    const data: CandlestickData[] = candles.map((candle) => ({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    series.setData(data);

    for (const priceLine of priceLinesRef.current) {
      series.removePriceLine(priceLine);
    }
    priceLinesRef.current = lines.map((line) =>
      series.createPriceLine({
        price: line.price,
        color: line.kind === 'buy' ? '#d73333' : '#2d4fca',
        lineWidth: 1,
        lineStyle: line.kind === 'buy' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.label,
      }),
    );

    if (isFirstLoad || !prevRange) {
      const total = data.length;
      const shown = Math.min(60, total);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, total - shown),
        to: total - 1,
      });
    } else {
      const added = data.length - prevLengthRef.current;
      chart.timeScale().setVisibleLogicalRange(
        added > 0
          ? {
              from: prevRange.from + added,
              to: prevRange.to + added,
            }
          : prevRange,
      );
    }

    prevLengthRef.current = data.length;
  }, [candles, lines]);

  return <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />;
};

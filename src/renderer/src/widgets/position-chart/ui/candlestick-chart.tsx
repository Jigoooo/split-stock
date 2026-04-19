import type { DisplaySettings, MaPeriod } from '@renderer/entities/display-settings';
import { MA_PERIODS } from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import { type ReactElement, useEffect, useEffectEvent, useRef } from 'react';
import type { Candle } from '../model/use-position-chart';

type PriceLineHandle = ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>;
type LineStyleMap = { solid: number; dashed: number; dotted: number };

const LINE_STYLE_MAP: LineStyleMap = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

const MA_PERIODS_CONST = MA_PERIODS as MaPeriod[];

function computeMa(candles: Candle[], period: MaPeriod): Array<{ time: string; value: number }> {
  const result: Array<{ time: string; value: number }> = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j]?.close ?? 0;
    }
    const date = candles[i]?.date;
    if (date !== undefined) {
      result.push({ time: date, value: sum / period });
    }
  }
  return result;
}

export interface CandlestickChartProps {
  candles: Candle[];
  lines: Array<{ kind: 'buy' | 'sell-target'; label: string; price: number }>;
  onFetchMore: () => Promise<void>;
  reachedEnd: boolean;
  displaySettings?: DisplaySettings | null;
}

export const CandlestickChart = ({
  candles,
  lines,
  onFetchMore,
  reachedEnd,
  displaySettings,
}: CandlestickChartProps): ReactElement => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceLinesRef = useRef<PriceLineHandle[]>([]);
  const prevLengthRef = useRef(0);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<Partial<Record<MaPeriod, ISeriesApi<'Line'>>>>({});
  const onFetchMoreEvent = useEffectEvent(onFetchMore);

  // ── 차트 인스턴스 생성/정리 ────────────────────────────────────────
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
      volumeSeriesRef.current = null;
      maSeriesRef.current = {};
    };
  }, []);

  // ── range change → fetch more ─────────────────────────────────────
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

  // ── candles + lines + displaySettings → series update ────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (candles.length === 0) {
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
      if (volumeSeriesRef.current) {
        chart.removeSeries(volumeSeriesRef.current);
        volumeSeriesRef.current = null;
      }
      for (const period of MA_PERIODS_CONST) {
        const maSeries = maSeriesRef.current[period];
        if (maSeries) {
          chart.removeSeries(maSeries);
        }
      }
      maSeriesRef.current = {};
      priceLinesRef.current = [];
      prevLengthRef.current = 0;
      return;
    }

    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const isFirstLoad = seriesRef.current === null;

    // ── 볼륨 스케일 마진 계산 ─────────────────────────────────────
    const volSettings = displaySettings?.chart.volume;
    const heightPercent = volSettings?.heightPercent ?? 30;
    const volumeBottom = heightPercent / 100;

    // ── 캔들스틱 시리즈 ───────────────────────────────────────────
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
            thousandSeparator(price, { allowNegative: true, allowDecimal: true }),
        },
      });
      series.priceScale().applyOptions({
        scaleMargins: { top: 0.05, bottom: volumeBottom + 0.02 },
      });
      seriesRef.current = series;
    } else {
      series.priceScale().applyOptions({
        scaleMargins: { top: 0.05, bottom: volumeBottom + 0.02 },
      });
    }

    const data: CandlestickData[] = candles.map((candle) => ({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    series.setData(data);

    // ── 거래량 시리즈 ─────────────────────────────────────────────
    const upColor = volSettings?.upColor ?? 'rgba(220,38,38,0.5)';
    const downColor = volSettings?.downColor ?? 'rgba(37,99,235,0.5)';

    let volSeries = volumeSeriesRef.current;
    if (!volSeries) {
      volSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 1 - volumeBottom, bottom: 0 },
      });
      volumeSeriesRef.current = volSeries;
    } else {
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 1 - volumeBottom, bottom: 0 },
      });
    }

    volSeries.setData(
      candles.map((candle) => ({
        time: candle.date,
        value: candle.volume,
        color: candle.close >= candle.open ? upColor : downColor,
      })),
    );

    // ── MA 시리즈 ─────────────────────────────────────────────────
    for (const period of MA_PERIODS_CONST) {
      const maSettings = displaySettings?.chart.ma[period];
      const enabled = maSettings?.enabled ?? period <= 20;
      const color = maSettings?.color ?? '#888888';
      const width = maSettings?.width ?? 1;
      const style = maSettings?.style ?? 'solid';
      const lwStyle = LINE_STYLE_MAP[style] ?? LineStyle.Solid;

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
          lineStyle: lwStyle,
          priceScaleId: 'right',
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: {
            type: 'custom',
            formatter: (price: number): string =>
              thousandSeparator(price, { allowNegative: true, allowDecimal: true }),
          },
        });
        maSeriesRef.current[period] = maSeries;
      } else {
        maSeries.applyOptions({
          color,
          lineWidth: width as 1 | 2 | 3 | 4,
          lineStyle: lwStyle,
        });
      }

      maSeries.setData(computeMa(candles, period));
    }

    // ── 매수/익절 라인 ────────────────────────────────────────────
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

    // ── visible range 유지 ────────────────────────────────────────
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
  }, [candles, lines, displaySettings]);

  return <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />;
};

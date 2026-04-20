import type { DisplaySettings, MaPeriod } from '@renderer/entities/display-settings';
import { MA_PERIODS } from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
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
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { type CSSProperties, type ReactElement, useEffect, useEffectEvent, useRef } from 'react';
import type { Candle } from '../model/use-position-chart';

const DEFAULT_VISIBLE_BARS = 60;
const MIN_VISIBLE_BARS = 5;
const ZOOM_IN_FACTOR = 0.7;
const ZOOM_OUT_FACTOR = 1.4;
const OVERLAY_BUTTON_STYLE: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.35)',
  backdropFilter: 'blur(1px)',
  WebkitBackdropFilter: 'blur(1px)',
  borderColor: 'rgba(0, 0, 0, 0.08)',
};

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
  liveCandle: Candle | null;
  lines: Array<{ kind: 'buy' | 'sell-target'; label: string; price: number }>;
  onFetchMore: () => Promise<void>;
  reachedEnd: boolean;
  displaySettings?: DisplaySettings | null;
}

export const CandlestickChart = ({
  candles,
  liveCandle,
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

  // ── liveCandle → series.update (오늘 캔들 실시간 갱신) ────────────
  useEffect(() => {
    if (!liveCandle) return;
    const series = seriesRef.current;
    const volSeries = volumeSeriesRef.current;
    if (!series) return;

    series.update({
      time: liveCandle.date,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });

    if (volSeries) {
      const upColor = displaySettings?.chart.volume.upColor ?? 'rgba(220,38,38,0.5)';
      const downColor = displaySettings?.chart.volume.downColor ?? 'rgba(37,99,235,0.5)';
      volSeries.update({
        time: liveCandle.date,
        value: liveCandle.volume,
        color: liveCandle.close >= liveCandle.open ? upColor : downColor,
      });
    }
  }, [liveCandle, displaySettings]);

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
          thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
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
            thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
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
              thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
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

  const zoom = (factor: number): void => {
    const chart = chartRef.current;
    if (!chart) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const width = range.to - range.from;
    const newWidth = Math.max(MIN_VISIBLE_BARS, width * factor);
    const total = prevLengthRef.current;
    const to = total > 0 ? Math.min(range.to, total - 1) : range.to;
    const from = Math.max(0, to - newWidth);
    chart.timeScale().setVisibleLogicalRange({ from, to });
  };

  const handleReset = (): void => {
    const chart = chartRef.current;
    if (!chart) return;
    const total = prevLengthRef.current;
    if (total === 0) return;
    const shown = Math.min(DEFAULT_VISIBLE_BARS, total);
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, total - shown),
      to: total - 1,
    });
  };

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 240,
        width: '100%',
        display: 'flex',
      }}
    >
      <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          display: 'flex',
          gap: 4,
          zIndex: 2,
        }}
      >
        <Button
          dense
          iconOnly
          iconLeading={<ZoomIn size={14} />}
          title="확대"
          style={OVERLAY_BUTTON_STYLE}
          onClick={() => zoom(ZOOM_IN_FACTOR)}
        >
          차트 확대
        </Button>
        <Button
          dense
          iconOnly
          iconLeading={<ZoomOut size={14} />}
          title="축소"
          style={OVERLAY_BUTTON_STYLE}
          onClick={() => zoom(ZOOM_OUT_FACTOR)}
        >
          차트 축소
        </Button>
        <Button
          dense
          iconOnly
          iconLeading={<Maximize2 size={14} />}
          title="맞춤"
          style={OVERLAY_BUTTON_STYLE}
          onClick={handleReset}
        >
          차트 보기 초기화
        </Button>
      </div>
    </div>
  );
};

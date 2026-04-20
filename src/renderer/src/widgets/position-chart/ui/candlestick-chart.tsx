import type { DisplaySettings, MaPeriod } from '@renderer/entities/display-settings';
import { MA_PERIODS } from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import {
  type CandlestickData,
  CandlestickSeries,
  CrosshairMode,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  TickMarkType,
  type Time,
} from 'lightweight-charts';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { type CSSProperties, type ReactElement, useEffect, useEffectEvent, useRef } from 'react';
import { useDrawingTools } from '../model/use-drawing-tools';
import type { Candle } from '../model/use-position-chart';
import { DrawingToolbar } from './drawing-toolbar';

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

/**
 * lightweight-charts Time → Date.
 * setData 가 string 'YYYY-MM-DD' 로 들어오므로 대부분 string 경로. BusinessDay
 * /UTCTimestamp 도 안전 폴백.
 */
const timeToDate = (time: Time): Date | null => {
  if (typeof time === 'string') {
    // 로컬 타임존 기준 해석이라 틱 경계가 어긋나지 않음
    return new Date(`${time}T00:00:00`);
  }
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }
  if (time && typeof time === 'object' && 'year' in time) {
    return new Date(time.year, time.month - 1, time.day);
  }
  return null;
};

/**
 * X축 tick 라벨을 한국식으로. 줌 레벨에 따라 라이브러리가 tickType 을 바꿔 호출.
 *  - Year        : '2026'
 *  - Month       : '4월'
 *  - DayOfMonth  : '20'
 *  - Time 계열  : 'HH:mm' (분봉/체결 차트로 확장 대비)
 */
const formatTickKr = (time: Time, tickType: TickMarkType): string => {
  const d = timeToDate(time);
  if (!d) return '';
  switch (tickType) {
    case TickMarkType.Year:
      return `${d.getFullYear()}`;
    case TickMarkType.Month:
      return `${d.getMonth() + 1}월`;
    case TickMarkType.DayOfMonth:
      return `${d.getDate()}`;
    case TickMarkType.Time:
    case TickMarkType.TimeWithSeconds:
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    default:
      return '';
  }
};

/** 크로스헤어 hover 날짜 tooltip 포맷 — 항상 풀 날짜. */
const formatCrosshairDateKr = (time: Time): string => {
  const d = timeToDate(time);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

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
  pdno: string;
  reachedEnd: boolean;
  displaySettings?: DisplaySettings | null;
}

const resolveCrosshairOptions = (displaySettings?: DisplaySettings | null) => {
  const crosshair = displaySettings?.chart.crosshair;
  const labelVisible = crosshair?.labelVisible ?? true;
  return {
    mode: crosshair?.mode === 'Normal' ? CrosshairMode.Normal : CrosshairMode.Magnet,
    vertLine: { labelVisible },
    horzLine: { labelVisible },
  };
};

export const CandlestickChart = ({
  candles,
  liveCandle,
  lines,
  onFetchMore,
  pdno,
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
  const drawingTools = useDrawingTools(pdno);
  const connectDrawingHost = drawingTools.connectHost;
  const disconnectDrawingHost = drawingTools.disconnectHost;

  // 드로잉 삭제는 자체 primitive detach + priceLine remove 로 처리 — 과거엔 차트
  // 전체를 remount 해서 localStorage 를 싸이클 시켰으나, Electron 이 IOSurface
  // 를 반복 할당하다 1x1 크기에서 실패 → "GPU state invalid" 로 UI 가 멈춰버림.
  // 현재는 series.removePriceLine / series.detachPrimitive 만 호출해 canvas 를
  // 그대로 두고 drawing state 만 비운다.
  const handleRemoveAllDrawings = drawingTools.removeAll;
  const handleRemoveLastDrawing = drawingTools.removeLast;

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
      crosshair: resolveCrosshairOptions(),
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: { borderColor: '#cccccc' },
      timeScale: {
        borderColor: '#cccccc',
        tickMarkFormatter: formatTickKr,
      },
      localization: {
        locale: 'ko-KR',
        priceFormatter: (price: number): string =>
          thousandSeparator(Math.round(price), { allowNegative: true, allowDecimal: false }),
        timeFormatter: formatCrosshairDateKr,
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
      // 차트를 버리기 전에 drawing host 연결 해제 — primitive/priceLine 도 함께 detach.
      disconnectDrawingHost();
      chart.remove();
      chartRef.current = null;
      priceLinesRef.current = [];
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = {};
    };
  }, [disconnectDrawingHost]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      crosshair: resolveCrosshairOptions(displaySettings),
    });
  }, [displaySettings]);

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

    connectDrawingHost(chart, series);

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
  }, [candles, lines, displaySettings, connectDrawingHost]);

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
          zIndex: 2,
        }}
      >
        <DrawingToolbar
          activeTool={drawingTools.activeTool}
          disabled={!drawingTools.isReady}
          onStartDraw={drawingTools.startDraw}
          onRemoveLast={handleRemoveLastDrawing}
          onRemoveAll={handleRemoveAllDrawings}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
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

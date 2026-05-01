import type { DisplaySettings, MaPeriod } from '@renderer/entities/display-settings';
import { Button } from '@renderer/shared/ui';
import type { IChartApi, ISeriesApi, SeriesMarker, Time } from 'lightweight-charts';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { type ReactElement, useRef, useState } from 'react';
import {
  DEFAULT_VISIBLE_BARS,
  MIN_VISIBLE_BARS,
  OVERLAY_BUTTON_STYLE,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from '../config/candlestick-chart-config';
import type { PriceLineHandle } from '../model/candlestick-chart-types';
import { useAxisInsetMeasurement } from '../model/use-axis-inset-measurement';
import { useCandlestickData } from '../model/use-candlestick-data';
import { useChartInstance } from '../model/use-chart-instance';
import { useDrawingTools } from '../model/use-drawing-tools';
import { useHistoryFetch } from '../model/use-history-fetch';
import { useLiveCandleSeries } from '../model/use-live-candle-series';
import { useOhlcTooltip } from '../model/use-ohlc-tooltip';
import { useOverlayPriceLines } from '../model/use-overlay-price-lines';
import type { Candle } from '../model/use-position-chart';
import { useTradeMarkers } from '../model/use-trade-markers';
import { DrawingToolbar } from './drawing-toolbar';
import { OhlcTooltip } from './ohlc-tooltip';

export interface CandlestickChartProps {
  candles: Candle[];
  enableDrawingTools?: boolean;
  liveCandle: Candle | null;
  lines: Array<{ kind: 'buy' | 'sell-target'; nth: number; label: string; price: number }>;
  markers?: SeriesMarker<Time>[];
  onFetchMore: () => Promise<void>;
  chartKey?: string;
  pdno?: string;
  priceFormatter?: (price: number) => string;
  volumeFormatter?: (volume: number) => string;
  reachedEnd: boolean;
  displaySettings?: DisplaySettings | null;
}

export const CandlestickChart = ({
  candles,
  enableDrawingTools = true,
  liveCandle,
  lines,
  markers,
  onFetchMore,
  chartKey,
  pdno,
  priceFormatter,
  reachedEnd,
  volumeFormatter,
  displaySettings,
}: CandlestickChartProps): ReactElement => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceLinesRef = useRef<PriceLineHandle[]>([]);
  const prevLengthRef = useRef(0);
  const historyFetchArmedRef = useRef(true);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<Partial<Record<MaPeriod, ISeriesApi<'Line'>>>>({});
  const [axisRightInset, setAxisRightInset] = useState(72);
  const drawingTools = useDrawingTools(chartKey ?? pdno ?? 'default');

  useChartInstance({
    chartRef,
    containerRef: ref,
    disconnectDrawingHost: drawingTools.disconnectHost,
    displaySettings,
    maSeriesRef,
    priceLinesRef,
    seriesRef,
    setAxisRightInset,
    volumeSeriesRef,
  });
  useAxisInsetMeasurement({ candles, chartRef, setAxisRightInset });
  useHistoryFetch({ chartRef, historyFetchArmedRef, onFetchMore, reachedEnd });
  useLiveCandleSeries({ displaySettings, liveCandle, seriesRef, volumeSeriesRef });
  useCandlestickData({
    candles,
    chartRef,
    connectDrawingHost: drawingTools.connectHost,
    disconnectDrawingHost: drawingTools.disconnectHost,
    displaySettings,
    enableDrawingTools,
    maSeriesRef,
    prevLengthRef,
    priceLinesRef,
    seriesRef,
    volumeSeriesRef,
    ...(priceFormatter !== undefined ? { priceFormatter } : {}),
  });
  useOverlayPriceLines({ candles, lines, priceLinesRef, seriesRef });
  useTradeMarkers({ markers: markers ?? [], seriesRef });
  const tooltipState = useOhlcTooltip({
    candles,
    chartRef,
    liveCandle,
    seriesRef,
    volumeSeriesRef,
  });

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
    <div style={{ position: 'relative', flex: 1, minHeight: 240, width: '100%', display: 'flex' }}>
      <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />
      <OhlcTooltip
        axisRightInset={axisRightInset}
        state={tooltipState}
        {...(priceFormatter !== undefined ? { priceFormatter } : {})}
        {...(volumeFormatter !== undefined ? { volumeFormatter } : {})}
      />
      {enableDrawingTools ? (
        <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
          <DrawingToolbar
            activeTool={drawingTools.activeTool}
            disabled={!drawingTools.isReady}
            onStartDraw={drawingTools.startDraw}
            onRemoveLast={drawingTools.removeLast}
            onRemoveAll={drawingTools.removeAll}
          />
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: axisRightInset,
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

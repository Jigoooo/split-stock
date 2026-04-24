import type { DisplaySettings } from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { createChart } from 'lightweight-charts';
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react';
import {
  formatCrosshairDateKr,
  formatTickKr,
  resolveCrosshairOptions,
} from '../lib/candlestick-chart-format';
import type { CandlestickChartRefs } from './candlestick-chart-types';

interface UseChartInstanceParams extends Omit<CandlestickChartRefs, 'prevLengthRef'> {
  containerRef: RefObject<HTMLDivElement | null>;
  disconnectDrawingHost: () => void;
  displaySettings: DisplaySettings | null | undefined;
  setAxisRightInset: Dispatch<SetStateAction<number>>;
}

export function useChartInstance({
  chartRef,
  containerRef,
  disconnectDrawingHost,
  displaySettings,
  maSeriesRef,
  priceLinesRef,
  seriesRef,
  setAxisRightInset,
  volumeSeriesRef,
}: UseChartInstanceParams): void {
  useEffect(() => {
    const element = containerRef.current;
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

    let axisRaf: number | null = null;
    const measureAxis = (): void => {
      if (axisRaf !== null) return;
      axisRaf = requestAnimationFrame(() => {
        axisRaf = null;
        try {
          const width = chart.priceScale('right').width();
          setAxisRightInset(Math.max(24, Math.ceil(width) + 8));
        } catch {
          // chart may already be torn down in tests or during fast unmounts.
        }
      });
    };
    measureAxis();
    chart.timeScale().subscribeVisibleLogicalRangeChange(measureAxis);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (axisRaf !== null) cancelAnimationFrame(axisRaf);
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(measureAxis);
      } catch {
        // ignore
      }
      disconnectDrawingHost();
      chart.remove();
      chartRef.current = null;
      priceLinesRef.current = [];
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = {};
    };
  }, [
    chartRef,
    containerRef,
    disconnectDrawingHost,
    maSeriesRef,
    priceLinesRef,
    seriesRef,
    setAxisRightInset,
    volumeSeriesRef,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ crosshair: resolveCrosshairOptions(displaySettings) });
  }, [chartRef, displaySettings]);
}

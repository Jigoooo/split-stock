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

    let disposed = false;
    let resizeRaf: number | null = null;
    const handleResize = (): void => {
      if (disposed || chartRef.current !== chart) return;
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        if (disposed || chartRef.current !== chart) return;
        try {
          chart.applyOptions({ width: element.clientWidth, height: element.clientHeight || 340 });
        } catch {
          // lightweight-charts can throw if a late ResizeObserver callback races with remove().
        }
      });
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
      disposed = true;
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (axisRaf !== null) cancelAnimationFrame(axisRaf);
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(measureAxis);
      } catch {
        // ignore
      }
      disconnectDrawingHost();
      chartRef.current = null;
      try {
        chart.remove();
      } catch {
        // ignore disposal races during fast account/page switches.
      }
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
    try {
      chart.applyOptions({ crosshair: resolveCrosshairOptions(displaySettings) });
    } catch {
      // ignore late display-setting updates that arrive after chart teardown.
    }
  }, [chartRef, displaySettings]);
}

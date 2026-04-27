import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type Time,
} from 'lightweight-charts';
import { type ReactElement, useEffect, useRef } from 'react';
import type { WinRatePoint } from '../model/use-reports';

export interface WinRateLineChartProps {
  points: WinRatePoint[];
  height?: number;
}

/**
 * 일자별 승률 추이 라인 차트 (0~100%).
 * lightweight-charts LineSeries 재활용. priceScale 0~100 고정.
 */
export const WinRateLineChart = ({ points, height = 220 }: WinRateLineChartProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--fg-2)',
      },
      grid: {
        vertLines: { color: 'var(--border)' },
        horzLines: { color: 'var(--border)' },
      },
      rightPriceScale: { borderColor: 'var(--border)' },
      timeScale: { borderColor: 'var(--border)', timeVisible: false },
      handleScroll: false,
      handleScale: false,
      localization: {
        priceFormatter: (price: number) => `${(price * 100).toFixed(0)}%`,
      },
    });
    const series = chart.addSeries(LineSeries, {
      color: 'var(--accent)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      baseLineVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const onResize = (): void => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      points.map((p) => ({
        time: p.date as Time,
        value: p.winRate,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        className="muted"
      >
        선택한 기간에 승률 데이터가 없습니다.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type Time,
} from 'lightweight-charts';
import { type ReactElement, useEffect, useRef } from 'react';
import type { DailyPnlPoint } from '../model/use-reports';

export interface DailyPnlChartProps {
  points: DailyPnlPoint[];
  height?: number;
}

/**
 * 일별 누적 실현손익 라인 차트.
 * lightweight-charts 재활용 (position-chart 와 동일 라이브러리).
 * 빈 데이터 시 placeholder 표시.
 */
export const DailyPnlChart = ({ points, height = 240 }: DailyPnlChartProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // 차트 1회 생성
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
    });
    const series = chart.addSeries(LineSeries, {
      color: '#0284c7',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      baseLineVisible: true,
      baseLineColor: 'var(--border)',
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

  // points 변경 시 series 갱신
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data = points.map((p) => ({
      time: p.date as Time,
      value: p.cumulativePnlKrw,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="muted"
      >
        선택한 기간에 거래 데이터가 없습니다.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

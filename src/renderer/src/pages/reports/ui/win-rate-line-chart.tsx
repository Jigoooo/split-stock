import {
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { type ReactElement, useEffect, useMemo, useRef } from 'react';
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
  const baselineRef = useRef<IPriceLine | null>(null);

  // 평균 승률 → 라인 색상 결정. 55%↑ 빨강(승률 높음), 45%↓ 파랑(저조), 그 외 회색.
  // HTS 기본 컬러 토큰과 의미 일치 — 사용자가 한눈에 추세 판단 가능.
  const lineColor = useMemo(() => {
    if (points.length === 0) return '#94a3b8';
    const sum = points.reduce((acc, p) => acc + p.winRate, 0);
    const avg = sum / points.length;
    if (avg > 0.55) return '#dc2626';
    if (avg < 0.45) return '#2563eb';
    return '#94a3b8';
  }, [points]);

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
      color: lineColor,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      baseLineVisible: false,
    });
    // 50% 손익분기 점선 — 사용자가 라인이 위/아래 어느 쪽에 있는지 즉시 판단 가능.
    baselineRef.current = series.createPriceLine({
      price: 0.5,
      color: '#94a3b8',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '50%',
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
      baselineRef.current = null;
    };
  }, [height, lineColor]);

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

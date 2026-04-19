import { trpc } from '@renderer/shared/api/trpc';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type IChartApi,
  LineStyle,
} from 'lightweight-charts';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
  months?: number;
}

/**
 * 보유 종목 차트 + 차수 오버레이.
 * - lightweight-charts: candlestick + priceLine (buy: 빨강 실선, sell-target: 파랑 점선)
 * - tRPC market.getDailyChart 호출 → CandlestickData[] 매핑
 * - lines는 lot-overlay.buildLotOverlay 결과를 호출측이 주입
 */
export const PositionChart = (props: PositionChartProps): ReactElement => {
  const { pdno, name, lines, months = 3 } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartQuery = trpc.market.getDailyChart.useQuery({ code: pdno, months });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 340,
      layout: { background: { color: '#ffffff' }, textColor: '#222' },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: { borderColor: '#cccccc' },
      timeScale: { borderColor: '#cccccc' },
    });
    chartRef.current = chart;
    const handleResize = (): void => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = chartQuery.data?.candles;
    if (!chart || !candles || candles.length === 0) return;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#d73333',
      downColor: '#2d4fca',
      wickUpColor: '#d73333',
      wickDownColor: '#2d4fca',
      borderVisible: false,
    });
    const data: CandlestickData[] = candles.map((c) => ({
      time: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);

    for (const line of lines) {
      series.createPriceLine({
        price: line.price,
        color: line.kind === 'buy' ? '#d73333' : '#2d4fca',
        lineWidth: 1,
        lineStyle: line.kind === 'buy' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.label,
      });
    }
    chart.timeScale().fitContent();

    return () => {
      // chartRef.current가 이미 null(상위 useEffect cleanup이 먼저 돌았거나 리마운트)이면 스킵.
      // lightweight-charts는 disposed chart에 removeSeries 호출 시 throw가 남음.
      if (chartRef.current !== chart) return;
      try {
        chart.removeSeries(series);
      } catch {
        // chart가 이미 내부적으로 dispose된 경우 무시
      }
    };
  }, [chartQuery.data, lines]);

  return (
    <div className="panel">
      <div className="panel__title">
        {name} ({pdno}) — {months}개월 일봉 + 차수
      </div>
      <div className="panel__body" style={{ padding: '1.2rem' }}>
        {chartQuery.isPending ? (
          <div className="muted">차트 로드 중…</div>
        ) : chartQuery.error ? (
          <span className="chip chip--down">{chartQuery.error.message}</span>
        ) : null}
        <div ref={ref} style={{ width: '100%', minHeight: 340 }} />
      </div>
    </div>
  );
};

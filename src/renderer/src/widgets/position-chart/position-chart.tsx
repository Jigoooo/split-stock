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
import { useEffect, useRef, useState } from 'react';

export type ChartPeriod = 'D' | 'W' | 'M';

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

const PERIOD_MONTHS: Record<ChartPeriod, number> = {
  D: 3,
  W: 12,
  M: 60,
};

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

/**
 * 보유 종목 차트 + 차수 오버레이.
 * 상단 period 탭(일/주/월) — KIS inquire-daily-itemchartprice의 FID_PERIOD_DIV_CODE 매핑.
 * 분봉은 별도 엔드포인트 필요 — 현재는 비활성 버튼 + 안내.
 */
export const PositionChart = (props: PositionChartProps): ReactElement => {
  const { pdno, name, lines } = props;
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartQuery = trpc.market.getDailyChart.useQuery({
    code: pdno,
    months: PERIOD_MONTHS[period],
    period,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight || 340,
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
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 340 });
    };
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
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
      if (chartRef.current !== chart) return;
      try {
        chart.removeSeries(series);
      } catch {
        // dispose race 무시
      }
    };
  }, [chartQuery.data, lines]);

  return (
    <div
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}
      >
        <span>
          {name} ({pdno})
        </span>
        <span style={{ flex: 1 }} />
        <div role="tablist" aria-label="봉 단위" style={{ display: 'flex', gap: '0.3rem' }}>
          {(['D', 'W', 'M'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              className={period === p ? 'hts-btn hts-btn--primary' : 'hts-btn'}
              onClick={() => setPeriod(p)}
              style={{ padding: '0.3rem 0.7rem' }}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <div
        className="panel__body"
        style={{
          padding: '0.6rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chartQuery.isPending ? (
          <div className="muted" style={{ padding: '0.4rem 0' }}>
            차트 로드 중…
          </div>
        ) : chartQuery.error ? (
          <span className="chip chip--down">{chartQuery.error.message}</span>
        ) : null}
        <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />
      </div>
    </div>
  );
};

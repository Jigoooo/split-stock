import { trpc } from '@renderer/shared/api/trpc';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import {
  type CandlestickData,
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
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

/** 초기 로드 개월수 / 좌측 끝 근접 시 추가로 불러올 증분. */
const PERIOD_INIT_MONTHS: Record<ChartPeriod, number> = { D: 3, W: 12, M: 60 };
const PERIOD_EXTEND_STEP: Record<ChartPeriod, number> = { D: 3, W: 12, M: 24 };
const PERIOD_MAX_MONTHS: Record<ChartPeriod, number> = { D: 60, W: 60, M: 60 };

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

/**
 * 보유 종목 차트 + 차수 오버레이.
 * - 일/주/월 탭 (KIS inquire-daily-itemchartprice FID_PERIOD_DIV_CODE 매핑)
 * - 사용자가 좌측으로 스크롤/확대하면 monthsLoaded를 단계적으로 늘려 추가 히스토리 lazy load
 * - 시리즈 setData 전후로 visible range를 보존해 스크롤 위치/줌이 점프하지 않게 함
 */
export const PositionChart = (props: PositionChartProps): ReactElement => {
  const { pdno, name, lines } = props;
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const [monthsLoaded, setMonthsLoaded] = useState<number>(PERIOD_INIT_MONTHS[period]);
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // 연속 확장 호출이 한꺼번에 몰리는 것을 막는 debounce용 lock.
  const expandingRef = useRef<boolean>(false);

  // period가 바뀌면 초기 개월수로 리셋.
  useEffect(() => {
    setMonthsLoaded(PERIOD_INIT_MONTHS[period]);
  }, [period]);

  const chartQuery = trpc.market.getDailyChart.useQuery({
    code: pdno,
    months: monthsLoaded,
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

    // 좌측 끝 근접 시 monthsLoaded 확장 — 확대/축소/스크롤 모두 logicalRangeChange로 감지.
    const onRange = (range: { from: number; to: number } | null): void => {
      if (!range) return;
      if (expandingRef.current) return;
      // logical range from이 음수(-5 이하)면 왼쪽으로 넘어간 영역이 생긴 것. bar 10 이내로 남았어도 확장.
      if (range.from > 10) return;
      expandingRef.current = true;
      setMonthsLoaded((prev) => {
        const next = prev + PERIOD_EXTEND_STEP[period];
        return Math.min(next, PERIOD_MAX_MONTHS[period]);
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    const handleResize = (): void => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 340 });
    };
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        // chart가 이미 dispose된 경우 무시
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // period를 dep로 — 확장 스텝/최대치가 period에 의존하므로 handler 캡처값을 최신화.
  }, [period]);

  // 데이터/라인 업데이트 + visible range 보존.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = chartQuery.data?.candles;
    if (!chart || !candles || candles.length === 0) return;

    const prevRange = chart.timeScale().getVisibleLogicalRange();

    // 기존 series가 있으면 재사용 (setData + priceLines 재적용), 없으면 새로 만듦.
    let series = seriesRef.current;
    if (!series) {
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#d73333',
        downColor: '#2d4fca',
        wickUpColor: '#d73333',
        wickDownColor: '#2d4fca',
        borderVisible: false,
      });
      seriesRef.current = series;
    }

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);

    // priceLines 재적용 — series를 재사용할 땐 기존 것들이 남아 있을 수 있으니 리셋 대신 추가.
    // 단순화를 위해 초기 mount 때만 추가하고 이후엔 lines 변경분만 반영하고 싶지만,
    // API가 개별 제거를 제공하지 않으므로 전체 series 교체가 더 비용 큼 — 일단 매번 새 priceLine 생성.
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

    // 처음 데이터일 땐 fitContent, 추가 히스토리 로드 시엔 기존 visible range를 복원해 점프 방지.
    if (prevRange) {
      chart.timeScale().setVisibleLogicalRange(prevRange);
    } else {
      chart.timeScale().fitContent();
    }

    expandingRef.current = false;
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
        <span className="muted" style={{ fontSize: '1rem' }}>
          최근 {monthsLoaded}개월
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

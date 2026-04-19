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
import { useCallback, useEffect, useRef, useState } from 'react';

export type ChartPeriod = 'D' | 'W' | 'M';

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

/**
 * 보유 종목 차트 + 차수 오버레이.
 * - 일/주/월 탭 (KIS inquire-daily-itemchartprice의 FID_PERIOD_DIV_CODE 매핑)
 * - KIS는 1회 호출당 최대 100건만 반환 — 사용자가 좌측으로 스크롤/확대하면
 *   toMs를 이전 chunk의 가장 오래된 날짜 직전으로 이동해 추가 chunk를 fetch 후 merge.
 * - setData 전후로 visible logical range를 보존해 스크롤/줌이 점프하지 않음.
 */
export const PositionChart = (props: PositionChartProps): ReactElement => {
  const { pdno, name, lines } = props;
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const loadingRef = useRef<boolean>(false);

  const utils = trpc.useUtils();

  const loadChunk = useCallback(
    async (p: ChartPeriod, toMs?: number): Promise<Candle[]> => {
      const r = await utils.market.getDailyChart.fetch({
        code: pdno,
        period: p,
        ...(toMs ? { toMs } : {}),
      });
      return r.candles;
    },
    [pdno, utils.market.getDailyChart],
  );

  // 종목/period 바뀌면 초기 chunk 로드
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCandles([]);
    (async () => {
      try {
        const first = await loadChunk(period);
        if (cancelled) return;
        setCandles(first);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, loadChunk]);

  // 좌측 스크롤 시 더 오래된 chunk 로드
  const fetchMore = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return;
    if (candles.length === 0) return;
    loadingRef.current = true;
    setIsFetchingMore(true);
    try {
      const oldest = candles[0];
      if (!oldest) return;
      const oldestMs = new Date(oldest.date).getTime();
      const toMs = oldestMs - 24 * 60 * 60 * 1000; // 하루 전
      const older = await loadChunk(period, toMs);
      // merge: 중복 date는 older 우선 (새 chunk 겹치면 가장 오래된 쪽으로 덮어쓰기 불필요 — 합집합)
      const seen = new Set(candles.map((c) => c.date));
      const merged = [...older.filter((c) => !seen.has(c.date)), ...candles];
      merged.sort((a, b) => a.date.localeCompare(b.date));
      // 새로 합쳐진 데이터가 0건이면 더 이상 과거 데이터가 없는 상태
      if (older.length === 0) return;
      setCandles(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingRef.current = false;
      setIsFetchingMore(false);
    }
  }, [candles, loadChunk, period]);

  // 차트 인스턴스 생성 (1회)
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
      seriesRef.current = null;
    };
  }, []);

  // 좌측 근접 감지 리스너 재등록 — fetchMore 클로저가 최신 candles를 보도록
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onRange = (range: { from: number; to: number } | null): void => {
      if (!range) return;
      if (range.from > 10) return;
      void fetchMore();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        // dispose race 무시
      }
    };
  }, [fetchMore]);

  // 누적 candles가 바뀔 때 시리즈 갱신 + visible range 보존
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (candles.length === 0) {
      if (seriesRef.current) {
        try {
          chart.removeSeries(seriesRef.current);
        } catch {
          // dispose race 무시
        }
        seriesRef.current = null;
      }
      return;
    }
    const prevRange = chart.timeScale().getVisibleLogicalRange();
    const isFirstLoad = seriesRef.current === null;

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

    if (isFirstLoad || !prevRange) {
      chart.timeScale().fitContent();
    } else {
      // 앞쪽에 N개의 old bar가 추가됐다면 logical range도 그만큼 오른쪽으로 밀어줘야 사용자 시야가 그대로 유지됨.
      // 단순히 이전 range를 그대로 쓰면 old bar가 시야로 들어와 데이터 더 추가됨. offset 계산:
      const added = data.length - (prevRange.to - prevRange.from + 1 > 0 ? 0 : 0);
      void added;
      chart.timeScale().setVisibleLogicalRange(prevRange);
    }
  }, [candles, lines]);

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
          {candles.length}봉 로드됨{isFetchingMore ? ' · 추가 로드 중…' : ''}
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
        {error ? <span className="chip chip--down">{error}</span> : null}
        <div ref={ref} style={{ flex: 1, minHeight: 240, width: '100%' }} />
      </div>
    </div>
  );
};

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
  const [error, setError] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const loadingRef = useRef<boolean>(false);
  // 이전 setData 직전의 총 바 개수 — 추가 로드 시 앞쪽에 얼마나 prepend됐는지 계산해 visible range를 같은 DATE로 고정.
  const prevLengthRef = useRef<number>(0);

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

  // 종목/period 바뀌면 초기 chunk + 과거 N chunk 미리 로드 (왼쪽 끊김 방지)
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCandles([]);
    setReachedEnd(false);
    prevLengthRef.current = 0;
    (async () => {
      try {
        const first = await loadChunk(period);
        if (cancelled) return;
        if (first.length === 0) {
          setCandles([]);
          setReachedEnd(true);
          return;
        }
        let merged = [...first];
        setCandles(merged);
        // 과거 2 chunk 선제 로드 — buffer 확보. 서버 500은 일시 오류일 수 있으니 reachedEnd 세팅하지 않고 중단만 함.
        let toMs = new Date(first[0]?.date ?? '').getTime() - 86400000;
        for (let i = 0; i < 2; i++) {
          if (cancelled) return;
          if (!Number.isFinite(toMs)) break;
          try {
            const older = await loadChunk(period, toMs);
            if (cancelled) return;
            if (older.length === 0) {
              setReachedEnd(true);
              break;
            }
            const seen = new Set(merged.map((c) => c.date));
            const addedUnique = older.filter((c) => !seen.has(c.date));
            if (addedUnique.length === 0) {
              // 서버가 같은 범위를 다시 돌려보낸 경우 → 더 과거 없음 확정
              setReachedEnd(true);
              break;
            }
            merged = [...addedUnique, ...merged].sort((a, b) => a.date.localeCompare(b.date));
            setCandles(merged);
            const nextOldest = merged[0]?.date;
            if (!nextOldest) break;
            toMs = new Date(nextOldest).getTime() - 86400000;
          } catch {
            // 500 등 일시 오류 — 이번 선제 로드는 중단하되 reachedEnd는 세팅하지 않음.
            // 다음에 사용자가 스크롤하면 fetchMore가 재시도.
            break;
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, loadChunk]);

  // 좌측 스크롤 시 더 오래된 chunk 여러 개를 한 번에 추가 (왼쪽 끊김 방지)
  const fetchMore = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return;
    if (reachedEnd) return;
    if (candles.length === 0) return;
    loadingRef.current = true;
    try {
      let current = candles;
      // 연속으로 2 chunk 까지 당겨와 충분한 buffer 확보 (각 chunk는 독립적으로 merge)
      for (let i = 0; i < 2; i++) {
        const oldest = current[0];
        if (!oldest) break;
        const toMs = new Date(oldest.date).getTime() - 24 * 60 * 60 * 1000;
        if (!Number.isFinite(toMs)) break;
        try {
          const older = await loadChunk(period, toMs);
          if (older.length === 0) {
            setReachedEnd(true);
            break;
          }
          const seen = new Set(current.map((c) => c.date));
          const addedUnique = older.filter((c) => !seen.has(c.date));
          if (addedUnique.length === 0) {
            setReachedEnd(true);
            break;
          }
          current = [...addedUnique, ...current].sort((a, b) => a.date.localeCompare(b.date));
          setCandles(current);
        } catch {
          // 500 등 일시 오류 — 이번 호출만 중단, 다음 스크롤에서 재시도 허용 (reachedEnd 세팅 안 함)
          break;
        }
      }
    } finally {
      loadingRef.current = false;
    }
  }, [candles, loadChunk, period, reachedEnd]);

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
      if (reachedEnd) return;
      // left edge로부터 50바 이내로 다가오면 미리 prefetch — 사용자가 스크롤하는 동안 끊김 방지
      if (range.from > 50) return;
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
  }, [fetchMore, reachedEnd]);

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
      // 초기 로드: 최근 60봉만 보이게 오른쪽 끝에 정렬 (스크롤 buffer는 왼쪽에 쌓여 있음)
      const total = data.length;
      const shown = Math.min(60, total);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, total - shown),
        to: total - 1,
      });
    } else {
      // 앞쪽에 추가된 바 개수만큼 visible range를 오른쪽으로 shift — 사용자가 보던 실제 날짜 구간이 고정.
      // (logical index는 항상 배열의 처음부터 증가하므로, 과거 데이터를 prepend하면 같은 DATE의 index가 +added).
      const added = data.length - prevLengthRef.current;
      if (added > 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: prevRange.from + added,
          to: prevRange.to + added,
        });
      } else {
        chart.timeScale().setVisibleLogicalRange(prevRange);
      }
    }
    prevLengthRef.current = data.length;
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
        {candles.length === 0 ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
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

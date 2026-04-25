import { type LiveTick, useLiveTick } from '@renderer/entities/realtime';
import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useRef, useState } from 'react';

export type ChartPeriod = 'D' | 'W' | 'M';

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UsePositionChartResult {
  candles: Candle[];
  liveCandle: Candle | null;
  error: string | null;
  fetchMore: () => Promise<void>;
  isLoading: boolean;
  period: ChartPeriod;
  reachedEnd: boolean;
  retry: () => void;
  setPeriod: (period: ChartPeriod) => void;
}

function chartCacheKey(pdno: string, period: ChartPeriod): string {
  return `split-stock.position-chart.${pdno}.${period}`;
}

function readCachedCandles(pdno: string, period: ChartPeriod): Candle[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(chartCacheKey(pdno, period));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Candle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedCandles(pdno: string, period: ChartPeriod, candles: Candle[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chartCacheKey(pdno, period), JSON.stringify(candles));
  } catch {
    // ignore cache failures
  }
}

/** KST 기준 오늘 날짜를 YYYY-MM-DD 로 반환 */
function todayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPreviousDayMs(value: string): number {
  return new Date(value).getTime() - 24 * 60 * 60 * 1000;
}

function mergeOlderCandles(current: Candle[], older: Candle[]) {
  const seen = new Set(current.map((candle) => candle.date));
  const addedUnique = older.filter((candle) => !seen.has(candle.date));
  if (addedUnique.length === 0) {
    return {
      next: current,
      reachedEnd: true,
    };
  }

  return {
    next: [...addedUnique, ...current].sort((left, right) => left.date.localeCompare(right.date)),
    reachedEnd: false,
  };
}

function findTodayCandle(candles: Candle[], date: string): Candle | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (candle?.date === date) return candle;
  }
  return null;
}

/**
 * 일봉 live candle 계산.
 * - WS tick 이 장중 OHLC를 제대로 주면 그대로 사용
 * - REST fallback quote 처럼 open/high/low 가 0이면 오늘 일봉(base)을 기준으로 보정
 * - 오늘 일봉 자체가 없으면 close=price 기준의 1점 캔들로만 생성
 */
export function buildDailyLiveCandle(
  candles: Candle[],
  tick: LiveTick | null,
  period: ChartPeriod,
): Candle | null {
  if (period !== 'D' || tick === null) return null;
  if (!Number.isFinite(tick.price) || tick.price <= 0) return null;

  const date = todayKst();
  const base = findTodayCandle(candles, date);
  const hasValidOhlc = tick.open > 0 && tick.high > 0 && tick.low > 0;

  if (hasValidOhlc) {
    return {
      date,
      open: tick.open,
      high: tick.high,
      low: tick.low,
      close: tick.price,
      volume: Math.max(tick.accumVolume, 0),
    };
  }

  if (base) {
    const open = base.open > 0 ? base.open : tick.price;
    const high = Math.max(base.high, tick.price, open);
    const low = Math.min(base.low, tick.price, open);
    return {
      date,
      open,
      high,
      low,
      close: tick.price,
      volume: Math.max(base.volume, tick.accumVolume, tick.volume, 0),
    };
  }

  return {
    date,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: Math.max(tick.accumVolume, tick.volume, 0),
  };
}

export function usePositionChart(pdno: string): UsePositionChartResult {
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const [candles, setCandles] = useState<Candle[]>(() => readCachedCandles(pdno, 'D'));
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  const candlesRef = useRef<Candle[]>([]);
  const loadedPdnoRef = useRef(pdno);
  const loadingRef = useRef(false);
  const reachedEndRef = useRef(false);
  const utils = trpc.useUtils();
  // tRPC utils proxy 는 매 render 마다 새 reference 를 돌려줄 수 있어 effect dep 에
  // 넣으면 불필요하게 재실행 → setCandles([]) 가 반복 호출되며 차트 스크롤 위치가
  // 매 render 마다 초기화되는 회귀가 있었다. ref 로 최신 fetch 함수를 잡아 둔다.
  const fetchDailyChartRef = useRef(utils.market.getDailyChart.fetch);
  fetchDailyChartRef.current = utils.market.getDailyChart.fetch;

  // 일봉 전용 실시간 tick (period !== 'D' 이면 null 로 처리)
  const rawTick = useLiveTick(pdno, 1000);
  const liveCandle = buildDailyLiveCandle(candles, rawTick, period);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    writeCachedCandles(pdno, period, candles);
  }, [candles, pdno, period]);

  useEffect(() => {
    reachedEndRef.current = reachedEnd;
  }, [reachedEnd]);

  useEffect(() => {
    let cancelled = false;
    void reloadSeq;

    const loadInitial = async (): Promise<void> => {
      loadingRef.current = false;
      setIsLoading(true);
      setError(null);
      const cached = readCachedCandles(pdno, period);
      const pdnoChanged = loadedPdnoRef.current !== pdno;
      loadedPdnoRef.current = pdno;
      if (cached.length === 0) {
        if (pdnoChanged) {
          setCandles([]);
          candlesRef.current = [];
        }
      } else {
        setCandles(cached);
        candlesRef.current = cached;
      }
      setReachedEnd(false);
      reachedEndRef.current = false;

      try {
        const fetchInitial = async (): Promise<void> => {
          const first = await fetchDailyChartRef.current({ code: pdno, period });
          if (cancelled) return;

          if (first.candles.length === 0) {
            setReachedEnd(true);
            reachedEndRef.current = true;
            return;
          }

          let merged = [...first.candles];
          setCandles(merged);
          candlesRef.current = merged;

          let toMs = getPreviousDayMs(first.candles[0]?.date ?? '');
          for (let index = 0; index < 2; index += 1) {
            if (cancelled || !Number.isFinite(toMs)) break;

            try {
              const older = await fetchDailyChartRef.current({ code: pdno, period, toMs });
              if (cancelled) return;

              const olderOldestDate = older.candles[0]?.date ?? '';
              const currentOldestDate = merged[0]?.date ?? '';
              if (
                older.candles.length === 0 ||
                (currentOldestDate !== '' && olderOldestDate >= currentOldestDate)
              ) {
                if (older.candles.length > 0) {
                  const mergedResult = mergeOlderCandles(merged, older.candles);
                  merged = mergedResult.next;
                  setCandles(merged);
                  candlesRef.current = merged;
                }
                setReachedEnd(true);
                reachedEndRef.current = true;
                break;
              }

              const mergedResult = mergeOlderCandles(merged, older.candles);
              merged = mergedResult.next;
              setCandles(merged);
              candlesRef.current = merged;

              if (mergedResult.reachedEnd) {
                setReachedEnd(true);
                reachedEndRef.current = true;
                break;
              }

              const nextOldest = merged[0]?.date;
              if (!nextOldest) break;
              toMs = getPreviousDayMs(nextOldest);
            } catch {
              break;
            }
          }
        };

        if (cached.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (cancelled) return;
        }
        await fetchInitial();
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [pdno, period, reloadSeq]);

  const fetchMore = async (): Promise<void> => {
    if (loadingRef.current || reachedEndRef.current) return;

    let current = candlesRef.current;
    if (current.length === 0) return;

    loadingRef.current = true;
    try {
      const oldest = current[0];
      if (!oldest) return;

      const toMs = getPreviousDayMs(oldest.date);
      if (!Number.isFinite(toMs)) return;

      try {
        const older = await fetchDailyChartRef.current({ code: pdno, period, toMs });
        // 빈 응답 또는 새로 받은 candle 중 oldest 보다 더 과거가 하나도 없으면 상장일 도달.
        const olderOldestDate = older.candles[0]?.date ?? '';
        if (older.candles.length === 0 || olderOldestDate >= oldest.date) {
          setReachedEnd(true);
          reachedEndRef.current = true;
          if (older.candles.length > 0) {
            const merged = mergeOlderCandles(current, older.candles);
            current = merged.next;
            setCandles(current);
            candlesRef.current = current;
          }
          return;
        }

        const merged = mergeOlderCandles(current, older.candles);
        current = merged.next;
        setCandles(current);
        candlesRef.current = current;

        if (merged.reachedEnd) {
          setReachedEnd(true);
          reachedEndRef.current = true;
        }
      } catch {
        return;
      }
    } finally {
      loadingRef.current = false;
    }
  };

  const retry = (): void => {
    if (isLoading) return;
    setReloadSeq((seq) => seq + 1);
  };

  return {
    candles,
    liveCandle,
    error,
    fetchMore,
    isLoading,
    period,
    reachedEnd,
    retry,
    setPeriod,
  };
}

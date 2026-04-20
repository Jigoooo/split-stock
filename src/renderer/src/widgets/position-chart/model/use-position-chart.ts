import { useLiveTick } from '@renderer/entities/realtime';
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

export function usePositionChart(pdno: string): UsePositionChartResult {
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  const candlesRef = useRef<Candle[]>([]);
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
  const tick = period === 'D' ? rawTick : null;

  // tick → 오늘 캔들 계산
  // KIS WS tick 에는 당일 세션 open/high/low/accumVolume 이 포함됨
  const liveCandle: Candle | null =
    tick !== null
      ? {
          date: todayKst(),
          open: tick.open,
          high: tick.high,
          low: tick.low,
          close: tick.price,
          volume: tick.accumVolume,
        }
      : null;

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

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
      setCandles([]);
      candlesRef.current = [];
      setReachedEnd(false);
      reachedEndRef.current = false;

      try {
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

            if (older.candles.length === 0) {
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
        if (older.candles.length === 0) {
          setReachedEnd(true);
          reachedEndRef.current = true;
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

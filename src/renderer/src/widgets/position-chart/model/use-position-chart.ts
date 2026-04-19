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
  error: string | null;
  fetchMore: () => Promise<void>;
  isLoading: boolean;
  period: ChartPeriod;
  reachedEnd: boolean;
  retry: () => void;
  setPeriod: (period: ChartPeriod) => void;
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
        const first = await utils.market.getDailyChart.fetch({ code: pdno, period });
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
            const older = await utils.market.getDailyChart.fetch({ code: pdno, period, toMs });
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
  }, [pdno, period, reloadSeq, utils.market.getDailyChart]);

  const fetchMore = async (): Promise<void> => {
    if (loadingRef.current || reachedEndRef.current) return;

    let current = candlesRef.current;
    if (current.length === 0) return;

    loadingRef.current = true;
    try {
      for (let index = 0; index < 2; index += 1) {
        const oldest = current[0];
        if (!oldest) break;

        const toMs = getPreviousDayMs(oldest.date);
        if (!Number.isFinite(toMs)) break;

        try {
          const older = await utils.market.getDailyChart.fetch({ code: pdno, period, toMs });
          if (older.candles.length === 0) {
            setReachedEnd(true);
            reachedEndRef.current = true;
            break;
          }

          const merged = mergeOlderCandles(current, older.candles);
          current = merged.next;
          setCandles(current);
          candlesRef.current = current;

          if (merged.reachedEnd) {
            setReachedEnd(true);
            reachedEndRef.current = true;
            break;
          }
        } catch {
          break;
        }
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
    error,
    fetchMore,
    isLoading,
    period,
    reachedEnd,
    retry,
    setPeriod,
  };
}

import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useRef, useState } from 'react';
import { readCachedCandles, writeCachedCandles } from '../lib/position-chart-cache';
import { getPreviousDayMs, mergeOlderCandles } from '../lib/position-chart-helpers';
import type { Candle, ChartPeriod } from './candle-types';

export interface UsePositionChartCandlesResult {
  candles: Candle[];
  error: string | null;
  fetchMore: () => Promise<void>;
  isLoading: boolean;
  reachedEnd: boolean;
  retry: () => void;
}

/**
 * pdno + period 단위로 일봉 candles 를 fetch / cache / pagination 한다.
 * - 5 useState (candles, error, isLoading, reachedEnd, reloadSeq)
 * - 4 useRef (캔들/페이지네이션 sync 용)
 * - period state 와 live tick 합성은 facade(usePositionChart)가 담당.
 */
export function usePositionChartCandles(
  pdno: string,
  period: ChartPeriod,
): UsePositionChartCandlesResult {
  const [candles, setCandles] = useState<Candle[]>(() => readCachedCandles(pdno, period));
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

  return { candles, error, fetchMore, isLoading, reachedEnd, retry };
}

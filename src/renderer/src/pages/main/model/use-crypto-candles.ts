import { trpc } from '@renderer/shared/api/trpc';
import type { Candle } from '@renderer/widgets/position-chart/model/use-position-chart';
import type { CryptoCandle, CryptoCandleUnit } from '@shared/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface CryptoCandlesState {
  candles: Candle[];
  error: string | null;
  fetchMore: () => Promise<void>;
  isLoading: boolean;
  reachedEnd: boolean;
  retry: () => void;
}

const INITIAL_STATE = {
  candles: [] as Candle[],
  error: null as string | null,
  isLoading: false,
  reachedEnd: false,
};

function cacheKey(market: string, unit: CryptoCandleUnit): string {
  return `split-stock.crypto-chart.UPBIT.${market}.${unit}`;
}

function toChartCandle(candle: CryptoCandle): Candle {
  return {
    date: new Date(candle.candleAt).toISOString(),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume),
  };
}

function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  const byDate = new Map<string, Candle>();
  for (const candle of existing) byDate.set(candle.date, candle);
  for (const candle of incoming) byDate.set(candle.date, candle);
  return Array.from(byDate.values()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function readCache(market: string, unit: CryptoCandleUnit): Candle[] {
  try {
    const raw = localStorage.getItem(cacheKey(market, unit));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCandleLike).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  } catch {
    return [];
  }
}

function writeCache(market: string, unit: CryptoCandleUnit, candles: Candle[]): void {
  try {
    localStorage.setItem(cacheKey(market, unit), JSON.stringify(candles.slice(-600)));
  } catch {
    // localStorage quota/private mode failures are non-critical cache misses.
  }
}

function isCandleLike(value: unknown): value is Candle {
  if (typeof value !== 'object' || value === null) return false;
  const candle = value as Partial<Candle>;
  return (
    typeof candle.date === 'string' &&
    typeof candle.open === 'number' &&
    typeof candle.high === 'number' &&
    typeof candle.low === 'number' &&
    typeof candle.close === 'number' &&
    typeof candle.volume === 'number'
  );
}

export function useCryptoCandles(market: string, unit: CryptoCandleUnit): CryptoCandlesState {
  const utils = trpc.useUtils();
  const [{ candles, error, isLoading, reachedEnd }, setState] = useState(INITIAL_STATE);
  const request = useMemo(
    () => ({ exchange: 'UPBIT' as const, market, unit, count: 200 }),
    [market, unit],
  );

  const loadLatest = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const response = await utils.crypto.getCandles.fetch(request);
      const next = response.candles.map(toChartCandle);
      setState({
        candles: next,
        error: null,
        isLoading: false,
        reachedEnd: next.length < request.count,
      });
      writeCache(market, unit, next);
    } catch (cause) {
      setState((current) => ({
        ...current,
        error: cause instanceof Error ? cause.message : String(cause),
        isLoading: false,
      }));
    }
  }, [market, request, unit, utils.crypto.getCandles]);

  useEffect(() => {
    const cached = readCache(market, unit);
    setState({ ...INITIAL_STATE, candles: cached });
    void loadLatest();
  }, [loadLatest, market, unit]);

  const fetchMore = useCallback(async (): Promise<void> => {
    if (candles.length === 0 || isLoading || reachedEnd) return;
    const oldest = candles[0];
    if (!oldest) return;
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const response = await utils.crypto.getCandles.fetch({
        ...request,
        toMs: Date.parse(oldest.date) - 1,
      });
      const older = response.candles.map(toChartCandle);
      const next = mergeCandles(older, candles);
      setState({
        candles: next,
        error: null,
        isLoading: false,
        reachedEnd: older.length < request.count,
      });
      writeCache(market, unit, next);
    } catch (cause) {
      setState((current) => ({
        ...current,
        error: cause instanceof Error ? cause.message : String(cause),
        isLoading: false,
      }));
    }
  }, [candles, isLoading, market, reachedEnd, request, unit, utils.crypto.getCandles]);

  return {
    candles,
    error,
    fetchMore,
    isLoading,
    reachedEnd,
    retry: () => {
      void loadLatest();
    },
  };
}

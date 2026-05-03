import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useState } from 'react';

export interface PriceSnapshot {
  price: number;
  dayChange: number;
  dayChangeRate: number;
  open: number;
  high: number;
  low: number;
  upperLimit: number;
  lowerLimit: number;
  /** 누적거래대금 (원) */
  accumValue: number;
}

function priceCacheKey(pdno: string): string {
  return `split-stock.position-chart.price.${pdno}`;
}

function readCachedPrice(pdno: string): PriceSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(priceCacheKey(pdno));
    return raw ? (JSON.parse(raw) as PriceSnapshot) : null;
  } catch {
    return null;
  }
}

function writeCachedPrice(pdno: string, snapshot: PriceSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(priceCacheKey(pdno), JSON.stringify(snapshot));
  } catch {
    // ignore cache failures
  }
}

export function usePriceSnapshot(pdno: string): PriceSnapshot | null {
  const [cached, setCached] = useState<PriceSnapshot | null>(() => readCachedPrice(pdno));
  const [queryReady, setQueryReady] = useState(cached === null);

  useEffect(() => {
    const next = readCachedPrice(pdno);
    setCached(next);
    if (next === null) {
      setQueryReady(true);
      return;
    }

    setQueryReady(false);
    const id = window.setTimeout(() => setQueryReady(true), 900);
    return () => window.clearTimeout(id);
  }, [pdno]);

  const query = trpc.market.getPrice.useQuery(
    { code: pdno },
    { enabled: queryReady, refetchInterval: 8_000, staleTime: 0 },
  );

  useEffect(() => {
    if (!query.data) return;
    const next = query.data as PriceSnapshot;
    writeCachedPrice(pdno, next);
    setCached(next);
  }, [pdno, query.data]);

  return (query.data as PriceSnapshot | undefined) ?? cached;
}

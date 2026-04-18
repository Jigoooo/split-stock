import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useRef, useState } from 'react';

type Topic = 'tick' | 'orderbook';

export interface LiveTick {
  pdno: string;
  time: string;
  price: number;
  dayChange: number;
  dayChangeRate: number;
  tickDirection: 'UP' | 'DOWN' | 'FLAT' | 'UPPER_LIMIT' | 'LOWER_LIMIT';
  volume: number;
  accumVolume: number;
  open: number;
  high: number;
  low: number;
  bestAsk: number;
  bestBid: number;
}

export interface LiveOrderbookLevel {
  price: number;
  quantity: number;
}

export interface LiveOrderbook {
  pdno: string;
  time: string;
  asks: LiveOrderbookLevel[];
  bids: LiveOrderbookLevel[];
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number;
  expectedQty: number;
}

/**
 * 종목 실시간 구독 라이프사이클 훅.
 * - mount 시 watch(pdno, topic) 호출하여 main process에서 KIS WS 구독
 * - unmount 시 unwatch
 * - 최신 스냅샷은 주기적으로 polling (1초 default)
 */
export function useLiveTick(pdno: string, pollMs = 1000): LiveTick | null {
  useWatch(pdno, 'tick');
  const q = trpc.realtime.getLatestTick.useQuery({ pdno }, { refetchInterval: pollMs });
  return (q.data?.tick ?? null) as LiveTick | null;
}

export function useLiveOrderbook(pdno: string, pollMs = 500): LiveOrderbook | null {
  useWatch(pdno, 'orderbook');
  const q = trpc.realtime.getLatestOrderbook.useQuery({ pdno }, { refetchInterval: pollMs });
  return (q.data?.orderbook ?? null) as LiveOrderbook | null;
}

/**
 * 최근 N개 tick을 ring buffer로 보존 (체결창 원본).
 * - tick.time + accumVolume 조합으로 중복 필터
 */
export function useTradeFeed(pdno: string, capacity = 200): LiveTick[] {
  const tick = useLiveTick(pdno, 500);
  const [feed, setFeed] = useState<LiveTick[]>([]);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!tick) return;
    const key = `${tick.time}:${tick.accumVolume}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setFeed((prev) => {
      const next = [tick, ...prev];
      return next.length > capacity ? next.slice(0, capacity) : next;
    });
  }, [tick, capacity]);

  return feed;
}

function useWatch(pdno: string, topic: Topic): void {
  const watchMutation = trpc.realtime.watch.useMutation();
  const unwatchMutation = trpc.realtime.unwatch.useMutation();
  const watchRef = useRef(watchMutation.mutate);
  const unwatchRef = useRef(unwatchMutation.mutate);
  watchRef.current = watchMutation.mutate;
  unwatchRef.current = unwatchMutation.mutate;

  useEffect(() => {
    watchRef.current({ pdno, topic });
    return () => {
      unwatchRef.current({ pdno, topic });
    };
  }, [pdno, topic]);
}

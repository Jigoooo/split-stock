import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

type Topic = 'tick' | 'orderbook';

export type WsRoutingMode = 'WS' | 'POLLING' | 'UNKNOWN';

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
 * - mount 시 watch(pdno, topic) 호출하여 main process에서 KIS WS 구독 등록 (priority=60 기본)
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
  const ws = trpc.realtime.getLatestOrderbook.useQuery({ pdno }, { refetchInterval: pollMs });
  // WS 피드가 오지 않는 장외 시간대를 위한 REST fallback (5초 간격).
  const rest = trpc.market.getOrderbook.useQuery(
    { code: pdno },
    { refetchInterval: 5000, staleTime: 3000 },
  );
  const wsData = (ws.data?.orderbook ?? null) as LiveOrderbook | null;
  if (wsData) return wsData;
  return (rest.data?.orderbook ?? null) as LiveOrderbook | null;
}

/**
 * 사용자가 보고 있는 종목을 priority=100 으로 끌어올리고, 종목 변경 시 이전 종목은 자동 강등.
 * 같은 pdno 가 자동매매/예약매수 등 다른 경로로도 watch 중이라면 unmount 후에도 watch 자체는 살아 있음.
 *
 * env 를 deps 에 포함 — 계좌 전환으로 env 가 바뀌면 서버가 realtime 인스턴스를 재생성하므로
 * (context.ts `setCurrentEnv` → 새 RealtimeService), 새 인스턴스에 focus 를 다시 보내야 한다.
 */
export function useFocusedSubscription(pdno: string): void {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  const focusMutation = trpc.realtime.focus.useMutation();
  const blurMutation = trpc.realtime.blur.useMutation();
  const focus = useEffectEvent((next: string) => {
    focusMutation.mutate({ pdno: next });
  });
  const blur = useEffectEvent((next: string) => {
    blurMutation.mutate({ pdno: next });
  });

  useEffect(() => {
    if (env === null) return;
    focus(pdno);
    return () => {
      blur(pdno);
    };
  }, [pdno, env]);
}

/**
 * 종목별 WS/REST 라우팅 모드 — orderbook-panel 등 UI 인디케이터에 사용.
 * WS 슬롯에 배정되면 'WS', capacity 초과로 REST 폴링이면 'POLLING'.
 * 데이터 미수집 상태(start 전 등)는 'UNKNOWN'.
 */
export function useRoutingMode(pdno: string, pollMs = 2000): WsRoutingMode {
  const q = trpc.realtime.getRoutingStatus.useQuery({ pdno }, { refetchInterval: pollMs });
  const sub = q.data?.subscriptions.find((s) => s.pdno === pdno);
  if (!sub) return 'UNKNOWN';
  return sub.isWS ? 'WS' : 'POLLING';
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

/**
 * env 를 deps 에 포함 — 계좌 전환으로 env 가 바뀌면 서버가 realtime 인스턴스를 재생성하므로
 * (context.ts `setCurrentEnv` → 새 RealtimeService, 이전 watches 는 소실), 새 인스턴스에
 * watch 를 다시 보내야 호가/체결 피드가 재개된다.
 */
function useWatch(pdno: string, topic: Topic): void {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  const watchMutation = trpc.realtime.watch.useMutation();
  const unwatchMutation = trpc.realtime.unwatch.useMutation();
  const watch = useEffectEvent((nextPdno: string, nextTopic: Topic) => {
    watchMutation.mutate({ pdno: nextPdno, topic: nextTopic });
  });
  const unwatch = useEffectEvent((nextPdno: string, nextTopic: Topic) => {
    unwatchMutation.mutate({ pdno: nextPdno, topic: nextTopic });
  });

  useEffect(() => {
    if (env === null) return;
    watch(pdno, topic);
    return () => {
      unwatch(pdno, topic);
    };
  }, [pdno, topic, env]);
}

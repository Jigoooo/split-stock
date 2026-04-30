import { trpc } from '@renderer/shared/api/trpc';
import { usePopoutVisibility } from '@renderer/shared/lib/popout-window';
import { useEffect, useEffectEvent } from 'react';

type Topic = 'tick';

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

export function useLiveTick(pdno: string, pollMs = 1000): LiveTick | null {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  const popoutVisible = usePopoutVisibility();
  useWatch(pdno, 'tick', popoutVisible);
  const subscription = trpc.realtime.onTick.useSubscription(
    { pdno },
    {
      enabled: env !== null && popoutVisible,
    },
  );
  const fallbackQuery = trpc.realtime.getLatestTick.useQuery(
    { pdno },
    {
      enabled: env !== null && popoutVisible && subscription.status === 'error',
      refetchInterval: popoutVisible ? pollMs : false,
    },
  );
  return (subscription.data ?? fallbackQuery.data?.tick ?? null) as LiveTick | null;
}

function useWatch(pdno: string, topic: Topic, enabled: boolean): void {
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
    if (env === null || !enabled) return;
    watch(pdno, topic);
    return () => {
      unwatch(pdno, topic);
    };
  }, [pdno, topic, env, enabled]);
}

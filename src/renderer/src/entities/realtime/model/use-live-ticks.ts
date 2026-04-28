import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useEffectEvent, useMemo } from 'react';
import type { LiveTick } from './use-live-tick';

type Topic = 'tick';

export function useLiveTicks(pdnos: string[], pollMs = 1000): Record<string, LiveTick | null> {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  const uniquePdnos = useMemo(
    () => Array.from(new Set(pdnos.filter((pdno) => /^\d{6}$/.test(pdno)))).sort(),
    [pdnos],
  );
  useWatchMany(uniquePdnos, 'tick');
  const query = trpc.realtime.getLatestTicks.useQuery(
    { pdnos: uniquePdnos },
    {
      enabled: env !== null && uniquePdnos.length > 0,
      refetchInterval: pollMs,
    },
  );
  return (query.data?.ticks ?? {}) as Record<string, LiveTick | null>;
}

function useWatchMany(pdnos: string[], topic: Topic): void {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  const watchMutation = trpc.realtime.watch.useMutation();
  const unwatchMutation = trpc.realtime.unwatch.useMutation();
  const watchMany = useEffectEvent((nextPdnos: string[], nextTopic: Topic) => {
    for (const pdno of nextPdnos) {
      watchMutation.mutate({ pdno, topic: nextTopic });
    }
  });
  const unwatchMany = useEffectEvent((nextPdnos: string[], nextTopic: Topic) => {
    for (const pdno of nextPdnos) {
      unwatchMutation.mutate({ pdno, topic: nextTopic });
    }
  });

  useEffect(() => {
    if (env === null || pdnos.length === 0) return;
    watchMany(pdnos, topic);
    return () => {
      unwatchMany(pdnos, topic);
    };
  }, [pdnos, topic, env]);
}

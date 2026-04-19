import { trpc } from '@renderer/shared/api/trpc';
import { useEffect } from 'react';

export function useTradeRuntime() {
  const envQuery = trpc.auth.getEnv.useQuery();
  const envReady = (envQuery.data?.env ?? null) !== null;
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: envReady,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => realtimeStatus.refetch(),
  });

  useEffect(() => {
    if (!envReady) return;
    if (realtimeStatus.data?.started) return;
    if (startRealtime.isPending || startRealtime.isSuccess) return;
    startRealtime.mutate();
  }, [envReady, realtimeStatus.data?.started, startRealtime]);

  return {
    isProd: envQuery.data?.env === 'PROD',
    isRealtimeStarted: realtimeStatus.data?.started ?? false,
    startRealtimePending: startRealtime.isPending,
    startRealtimeError: startRealtime.error?.message ?? null,
  };
}

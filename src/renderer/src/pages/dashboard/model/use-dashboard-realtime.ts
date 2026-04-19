import { trpc } from '@renderer/shared/api/trpc';

export function useDashboardRealtime() {
  const envQuery = trpc.auth.getEnv.useQuery();
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: (envQuery.data?.env ?? null) !== null,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation();

  return {
    isProd: envQuery.data?.env === 'PROD',
    isStarted: realtimeStatus.data?.started ?? false,
    start: () => startRealtime.mutate(),
    startPending: startRealtime.isPending,
    startError: startRealtime.error?.message ?? null,
  };
}

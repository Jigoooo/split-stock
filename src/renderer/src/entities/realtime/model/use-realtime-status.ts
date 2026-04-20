import { trpc } from '@renderer/shared/api/trpc';

export function useRealtimeStatus(refetchInterval = 3000) {
  const status = trpc.realtime.status.useQuery(undefined, { refetchInterval });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => status.refetch(),
  });

  return {
    started: status.data?.started ?? false,
    watched: status.data?.watched ?? [],
    reconnectPending: startRealtime.isPending,
    reconnectError: startRealtime.error?.message ?? null,
    reconnect: () => startRealtime.mutate(),
  };
}

import { trpc } from '@renderer/shared/api/trpc';

export interface PendingCancelActiveItem {
  pdno: string;
  side: 'BUY' | 'SELL';
  nth: number;
  odno: string;
  attempts: number;
  accountId?: number;
}

export interface UsePendingCancelActiveResult {
  isPending: boolean;
  error: { message: string } | null;
  items: PendingCancelActiveItem[];
  refetch: () => void;
}

export function usePendingCancelActive(): UsePendingCancelActiveResult {
  const query = trpc.pendingCancel.listActive.useQuery(undefined, {
    refetchInterval: 3000,
  });

  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    items: (query.data?.items ?? []) as PendingCancelActiveItem[],
    refetch: () => void query.refetch(),
  };
}

import { trpc } from '@renderer/shared/api/trpc';
import type { WatchHistoryItem } from '../model/types';

export interface UseWatchHistoryResult {
  isPending: boolean;
  error: { message: string } | null;
  items: WatchHistoryItem[];
}

export function useWatchHistory(limit = 200): UseWatchHistoryResult {
  const query = trpc.watch.history.useQuery({ limit });
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    items: (query.data?.items ?? []) as WatchHistoryItem[],
  };
}

import { trpc } from '@renderer/shared/api/trpc';
import type { WatchHistoryItem } from '../model/types';

export interface UseWatchHistoryResult {
  isPending: boolean;
  error: { message: string } | null;
  items: WatchHistoryItem[];
}

/**
 * broker 인자 — KIS/KIWOOM=event_logs(category='WATCH'), UPBIT=event_logs(category='AUTO_CRYPTO')
 * 를 WatchHistoryItem shape 으로 매핑해 반환 (Phase 4-bis).
 */
export function useWatchHistory(limit = 200, broker?: string): UseWatchHistoryResult {
  const query = trpc.watch.history.useQuery({
    limit,
    ...(broker !== undefined ? { broker } : {}),
  });
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    items: (query.data?.items ?? []) as WatchHistoryItem[],
  };
}

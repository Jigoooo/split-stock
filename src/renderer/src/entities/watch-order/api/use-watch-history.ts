import { trpc } from '@renderer/shared/api/trpc';
import type { WatchHistoryItem } from '../model/types';

export interface UseWatchHistoryResult {
  isPending: boolean;
  error: { message: string } | null;
  items: WatchHistoryItem[];
}

/**
 * Phase R3-2: broker 인자 (default 'KIS'). 코인 page 가 'UPBIT' 로 호출 가능.
 * 서버 핸들러는 R3-3 까지 broker 무시(STOCK_BROKER 하드코딩) — client 측 인자만 prepared.
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

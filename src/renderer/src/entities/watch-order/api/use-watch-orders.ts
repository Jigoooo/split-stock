import { trpc } from '@renderer/shared/api/trpc';
import type { WatchOrder, WatchSource, WatchStatus } from '../model/types';

export interface UseWatchOrdersFilter {
  status?: WatchStatus;
  source?: WatchSource;
  accountId?: number;
}

export interface UseWatchOrdersResult {
  isPending: boolean;
  error: { message: string } | null;
  orders: WatchOrder[];
}

/**
 * 통합 자동감시주문 목록.
 * status / source / accountId 필터링 지원. W3-5 watch-board 4탭에서 사용.
 */
export function useWatchOrders(filter: UseWatchOrdersFilter = {}): UseWatchOrdersResult {
  const query = trpc.watch.list.useQuery(filter);
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    orders: (query.data?.orders ?? []) as WatchOrder[],
  };
}

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
 *
 * Phase R3-2: broker 인자 (default 'KIS'). 코인 page 가 'UPBIT' 로 호출 가능.
 * 서버 핸들러는 R3-3 까지 broker 무시(STOCK_BROKER 하드코딩) — client 측 인자만 prepared.
 */
export function useWatchOrders(
  filter: UseWatchOrdersFilter = {},
  broker?: string,
): UseWatchOrdersResult {
  const query = trpc.watch.list.useQuery({
    ...filter,
    ...(broker !== undefined ? { broker } : {}),
  });
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    orders: (query.data?.orders ?? []) as WatchOrder[],
  };
}

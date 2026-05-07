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
 * broker 인자 — 모든 broker 가 watchOrders 테이블에 저장됨 (P4-4 후 단일 source-of-truth).
 * 서버 listWatchOrders 핸들러가 broker 필터로 분기: KIS/KIWOOM=watchEngine, UPBIT=직접 SELECT.
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

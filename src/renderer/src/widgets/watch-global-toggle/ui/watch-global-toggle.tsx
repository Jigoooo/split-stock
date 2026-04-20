import { useActiveAccountId } from '@renderer/entities/account';
import { useWatchOrders } from '@renderer/entities/watch-order';
import type { ReactElement } from 'react';

/**
 * 헤더 자동감시 카운터 칩.
 *
 * 활성 계좌의 WATCHING 상태 자동감시 건수를 표시.
 * accountId 가 없으면 "—" 표시.
 */
export const WatchGlobalToggle = (): ReactElement => {
  const { accountId } = useActiveAccountId();

  const { orders, isPending } = useWatchOrders(
    accountId !== null ? { accountId, status: 'WATCHING' } : {},
  );

  if (accountId === null) {
    return <span className="chip">자동감시 —</span>;
  }

  if (isPending) {
    return <span className="chip">자동감시 …</span>;
  }

  return <span className="chip">자동감시 ({orders.length})</span>;
};

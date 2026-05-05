import { useActiveAccountId } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { alertDialog } from '@renderer/shared/ui';
import { useState } from 'react';

export function useActiveOrders(pdnoFilter?: string | null, broker?: string) {
  const utils = trpc.useUtils();
  const { accountId } = useActiveAccountId();
  const query = trpc.order.listActive.useQuery(broker !== undefined ? { broker } : undefined, {
    refetchInterval: 2000,
  });
  const cancelMany = trpc.order.cancelMany.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const allOrders = query.data?.orders ?? [];
  const orders = pdnoFilter ? allOrders.filter((order) => order.pdno === pdnoFilter) : allOrders;
  const selectedOrders = orders.filter((order) => selected.has(order.odno));
  const selectedRemainingQty = selectedOrders.reduce((sum, order) => sum + order.remainingQty, 0);

  const toggle = (odno: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(odno)) next.delete(odno);
      else next.add(odno);
      return next;
    });
  };

  const cancelSelected = async (): Promise<void> => {
    const odnos = Array.from(selected);
    if (odnos.length === 0) return;
    if (accountId === null) return;
    const confirmed = await alertDialog.confirm({
      title: '미체결 주문 일괄 취소',
      message: `${odnos.length}건 일괄 취소하시겠습니까? 남은 수량 합계: ${thousandSeparator(selectedRemainingQty)}주`,
      confirmText: '취소 진행',
      cancelText: '닫기',
    });
    if (!confirmed) return;
    await cancelMany.mutateAsync({ odnos, accountId });
    setSelected(new Set());
  };

  return {
    orders,
    selected,
    queryPending: query.isPending,
    cancelPending: cancelMany.isPending,
    cancelError: cancelMany.error?.message ?? null,
    noActiveAccount: accountId === null,
    toggle,
    cancelSelected,
  };
}

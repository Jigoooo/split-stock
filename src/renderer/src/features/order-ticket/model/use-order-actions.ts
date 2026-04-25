import { useActiveAccountId } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';

interface PlaceInput {
  pdno: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  division: 'LIMIT' | 'MARKET';
}

interface UseOrderActionsReturn {
  place: (input: PlaceInput) => Promise<unknown>;
  cancel: (args: { odno: string }) => Promise<unknown>;
  isPending: boolean;
  /** 활성 계좌 미선택 시 true — UI 는 disabled. */
  noActiveAccount: boolean;
  lastError: string | null;
}

export function useOrderActions(): UseOrderActionsReturn {
  const utils = trpc.useUtils();
  const { accountId } = useActiveAccountId();
  // 자동보정 적용 안내는 toast 제거 — main event_logs 'order.price-correction.applied'
  // 와 reports 의 일일 운영 요약 카드(호가 자동보정 카운트)로 사용자가 사후 확인.
  const place = trpc.order.placeCash.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });
  const cancelMany = trpc.order.cancelMany.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });

  return {
    place: (input) => {
      if (accountId === null) return Promise.reject(new Error('활성 계좌 없음'));
      return place.mutateAsync({ ...input, accountId });
    },
    cancel: ({ odno }) => {
      if (accountId === null) return Promise.reject(new Error('활성 계좌 없음'));
      return cancelMany.mutateAsync({ odnos: [odno], accountId });
    },
    isPending: place.isPending || cancelMany.isPending,
    noActiveAccount: accountId === null,
    lastError: place.error?.message ?? cancelMany.error?.message ?? null,
  };
}

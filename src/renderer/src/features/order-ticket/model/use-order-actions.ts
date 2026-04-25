import { useActiveAccountId } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { toast } from 'sonner';

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
  const place = trpc.order.placeCash.useMutation({
    onSuccess: (data) => {
      void utils.order.listActive.invalidate();
      // 자동보정으로 입력가가 변경됐다면 사용자에게 명시적 안내 (KIS 에는 보정가가 들어감).
      const correction = (
        data as
          | {
              priceCorrection?: {
                applied: boolean;
                originalPrice?: number;
                correctedPrice?: number;
              };
            }
          | undefined
      )?.priceCorrection;
      if (
        correction?.applied &&
        correction.originalPrice !== undefined &&
        correction.correctedPrice !== undefined
      ) {
        toast.info(
          `호가 자동보정: ${correction.originalPrice.toLocaleString()} → ${correction.correctedPrice.toLocaleString()}원`,
        );
      }
    },
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

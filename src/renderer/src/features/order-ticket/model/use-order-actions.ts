import { trpc } from '@renderer/shared/api/trpc';

type PlaceInput = Parameters<typeof trpc.order.placeCash.useMutation>[0] extends infer _
  ? {
      pdno: string;
      side: 'BUY' | 'SELL';
      qty: number;
      price: number;
      division: 'LIMIT' | 'MARKET';
    }
  : never;

interface UseOrderActionsReturn {
  place: (input: PlaceInput) => Promise<unknown>;
  cancel: (args: { odno: string }) => Promise<unknown>;
  isPending: boolean;
  lastError: string | null;
}

export function useOrderActions(): UseOrderActionsReturn {
  const utils = trpc.useUtils();
  const place = trpc.order.placeCash.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });
  const cancelMany = trpc.order.cancelMany.useMutation({
    onSuccess: () => utils.order.listActive.invalidate(),
  });

  return {
    place: (input) => place.mutateAsync(input),
    cancel: ({ odno }) => cancelMany.mutateAsync({ odnos: [odno] }),
    isPending: place.isPending || cancelMany.isPending,
    lastError: place.error?.message ?? cancelMany.error?.message ?? null,
  };
}

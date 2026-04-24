import { trpc } from '@renderer/shared/api/trpc';

export interface UseSyncCurrentStateResult {
  isPending: boolean;
  mutateAsync: (input: { accountId: number }) => Promise<unknown>;
}

export function useSyncCurrentState(accountId: number): UseSyncCurrentStateResult {
  const utils = trpc.useUtils();

  const mutation = trpc.account.syncCurrentState.useMutation({
    onMutate: () => {
      console.info('[PositionsGrid] syncCurrentState requested', { accountId });
    },
    onSuccess: (result) => {
      console.info('[PositionsGrid] syncCurrentState accepted', result);
      void Promise.all([
        utils.account.getBalanceWithLots.invalidate(),
        utils.account.getPositionOverlay.invalidate(),
        utils.lots.cyclesByPdno.invalidate(),
        utils.lots.tradeHistory.invalidate(),
        utils.order.listActive.invalidate(),
        utils.order.listMyFills.invalidate(),
      ]);
    },
    onError: (error) => {
      console.error('[PositionsGrid] syncCurrentState failed', error);
    },
  });

  return {
    isPending: mutation.isPending,
    mutateAsync: (input) => mutation.mutateAsync(input),
  };
}

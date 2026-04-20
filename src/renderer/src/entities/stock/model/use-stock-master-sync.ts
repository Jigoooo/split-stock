import { trpc } from '@renderer/shared/api/trpc';

export function useStockMasterSync() {
  const status = trpc.market.getStockMasterStatus.useQuery();
  const utils = trpc.useUtils();
  const syncMutation = trpc.market.syncStockMaster.useMutation({
    onSuccess: async () => {
      await utils.market.listAllStock.invalidate();
      status.refetch();
    },
  });

  return {
    isEmpty: !status.isLoading && (status.data?.total ?? 0) === 0,
    syncPending: syncMutation.isPending,
    syncError: syncMutation.error?.message ?? null,
    sync: () => syncMutation.mutate(),
  };
}

import { trpc } from '@renderer/shared/api/trpc';

export function useStockMasterSync() {
  const status = trpc.market.getStockMasterStatus.useQuery();
  const utils = trpc.useUtils();
  const syncMutation = trpc.market.syncStockMaster.useMutation({
    // fire-and-forget: listAllStock 은 ~수천 row 라 await 하면 syncPending 이 길게 잡힘.
    onSuccess: () => {
      void utils.market.listAllStock.invalidate();
      void status.refetch();
    },
  });

  return {
    isEmpty: !status.isLoading && (status.data?.total ?? 0) === 0,
    syncPending: syncMutation.isPending,
    syncError: syncMutation.error?.message ?? null,
    sync: () => syncMutation.mutate(),
  };
}

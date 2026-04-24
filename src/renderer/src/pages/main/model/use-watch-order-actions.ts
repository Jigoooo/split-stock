import { trpc } from '@renderer/shared/api/trpc';

export function useWatchOrderActions() {
  const utils = trpc.useUtils();
  const pauseMutation = trpc.watch.pause.useMutation();
  const resumeMutation = trpc.watch.resume.useMutation();
  const cancelMutation = trpc.watch.cancel.useMutation();

  const refresh = async (): Promise<void> => {
    await utils.watch.list.invalidate();
    await utils.watch.getControlState.invalidate();
    await utils.watch.history.invalidate();
  };

  const runForEach = async (
    ids: number[],
    mutateAsync: (input: { id: number }) => Promise<unknown>,
  ): Promise<void> => {
    for (const id of ids) {
      try {
        await mutateAsync({ id });
      } catch {
        // 개별 실패는 무시 — invalidate 후 새 상태 반영
      }
    }
    await refresh();
  };

  return {
    mutationPending:
      pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending,
    pauseSelected: (ids: number[]) => runForEach(ids, pauseMutation.mutateAsync),
    resumeSelected: (ids: number[]) => runForEach(ids, resumeMutation.mutateAsync),
    deleteSelected: (ids: number[]) => runForEach(ids, cancelMutation.mutateAsync),
  };
}

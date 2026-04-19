import { trpc } from '@renderer/shared/api/trpc';

export function useCredentialsReentry() {
  const utils = trpc.useUtils();
  const status = trpc.backup.needsCredentialsReentry.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const clear = trpc.backup.clearImportedFlag.useMutation({
    onSuccess: () => utils.backup.needsCredentialsReentry.invalidate(),
  });

  return {
    needsReentry: status.data?.needsReentry ?? false,
    clearPending: clear.isPending,
    clear: () => clear.mutate(),
  };
}

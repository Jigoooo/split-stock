import { trpc } from '@renderer/shared/api/trpc';

export interface SafetySnapshot {
  master: boolean;
  errorLock: {
    active: boolean;
    reason?: string | null;
  };
}

export interface UseSafetySwitchResult {
  isPending: boolean;
  error: { message: string } | null;
  snapshot: SafetySnapshot | null;
  setMasterPending: boolean;
  clearPending: boolean;
  setMaster: (on: boolean) => void;
  clearErrorLock: () => void;
}

export function useSafetySwitch(): UseSafetySwitchResult {
  const state = trpc.safety.getState.useQuery(undefined, {
    refetchInterval: 2000,
  });
  const setMaster = trpc.safety.setMaster.useMutation({
    onSuccess: () => state.refetch(),
  });
  const clear = trpc.safety.clearErrorLock.useMutation({
    onSuccess: () => state.refetch(),
  });

  return {
    isPending: state.isPending,
    error: state.error ? { message: state.error.message } : null,
    snapshot: state.data
      ? {
          master: state.data.master,
          errorLock: state.data.errorLock,
        }
      : null,
    setMasterPending: setMaster.isPending,
    clearPending: clear.isPending,
    setMaster: (on: boolean) => setMaster.mutate({ on }),
    clearErrorLock: () => clear.mutate(),
  };
}

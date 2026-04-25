import { trpc } from '@renderer/shared/api/trpc';
import { toast } from 'sonner';

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
    onSuccess: (_data, variables) => {
      void state.refetch();
      window.appShell?.broadcastSettingsChanged?.('safety');
      toast.success(variables.on ? '주문 허용 상태로 전환됨' : '주문 차단 상태로 전환됨');
    },
    onError: (err) => {
      toast.error(`안전 스위치 변경 실패: ${err.message}`);
    },
  });
  const clear = trpc.safety.clearErrorLock.useMutation({
    onSuccess: () => {
      void state.refetch();
      window.appShell?.broadcastSettingsChanged?.('safety');
      toast.success('오류 잠금이 해제되었습니다');
    },
    onError: (err) => {
      toast.error(`오류 잠금 해제 실패: ${err.message}`);
    },
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

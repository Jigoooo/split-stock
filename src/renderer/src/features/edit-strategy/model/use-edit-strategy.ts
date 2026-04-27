import { trpc } from '@renderer/shared/api/trpc';
import type { StrategyProfile } from '@shared/contracts';
import { toast } from 'sonner';

interface ActiveState {
  isPending: boolean;
  error: { message: string } | null;
  data:
    | {
        profile: StrategyProfile;
        source: 'symbol' | 'global' | 'default';
        hasOverride: boolean;
      }
    | undefined;
}

interface PresetsState {
  isPending: boolean;
  error: { message: string } | null;
  data: { presets: Array<{ name: string; profile: StrategyProfile }> } | undefined;
}

interface UseEditStrategyReturn {
  active: ActiveState;
  presets: PresetsState;
  save: (profile: StrategyProfile) => Promise<unknown>;
  clear: () => Promise<unknown>;
  saveAsPreset: (name: string, profile: StrategyProfile) => Promise<unknown>;
  removePreset: (name: string) => Promise<unknown>;
  isPending: boolean;
}

export function useEditStrategy(pdno: string | null): UseEditStrategyReturn {
  const utils = trpc.useUtils();
  const active = trpc.strategy.getEffectiveForEdit.useQuery({ pdno });
  const presets = trpc.strategy.listPresets.useQuery();

  // fire-and-forget: await 하면 무거운 query (getBalanceWithLots, getPositionOverlay 등)
  // refetch 가 끝날 때까지 mutation.isPending 이 잡혀 저장/초기화 버튼이 길게 disable 됨.
  const invalidateAll = (): void => {
    void utils.strategy.getActive.invalidate({ pdno });
    void utils.strategy.getEffectiveForEdit.invalidate({ pdno });
    void utils.strategy.getEffectiveForEdit.invalidate();
    void utils.strategy.getEffectiveMetas.invalidate();
    void utils.strategy.listPresets.invalidate();
    void utils.account.getBalanceWithLots.invalidate();
    if (pdno !== null) void utils.account.getPositionOverlay.invalidate({ pdno });
  };

  const broadcast = (): void => {
    window.appShell?.broadcastSettingsChanged?.('strategy');
  };

  const setActive = trpc.strategy.setActive.useMutation({
    onSuccess: async () => {
      invalidateAll();
      broadcast();
      toast.success(
        pdno === null ? '기본 매매설정이 저장되었습니다' : '활성 매매설정이 저장되었습니다',
      );
    },
    onError: (err) => {
      toast.error(`매매설정 저장 실패: ${err.message}`);
    },
  });
  const clearActive = trpc.strategy.clearActive.useMutation({
    onSuccess: async () => {
      invalidateAll();
      broadcast();
      toast.success(
        pdno === null ? '기본 매매설정이 초기화되었습니다' : '종목별 설정이 초기화되었습니다',
      );
    },
    onError: (err) => {
      toast.error(`매매설정 초기화 실패: ${err.message}`);
    },
  });
  const savePreset = trpc.strategy.savePreset.useMutation({
    onSuccess: async (_data, variables) => {
      invalidateAll();
      broadcast();
      toast.success(`템플릿 "${variables.name}" 저장됨`);
    },
    onError: (err) => {
      toast.error(`템플릿 저장 실패: ${err.message}`);
    },
  });
  const deletePreset = trpc.strategy.deletePreset.useMutation({
    onSuccess: async (_data, variables) => {
      invalidateAll();
      broadcast();
      toast.success(`템플릿 "${variables.name}" 삭제됨`);
    },
    onError: (err) => {
      toast.error(`템플릿 삭제 실패: ${err.message}`);
    },
  });

  return {
    active: {
      isPending: active.isPending,
      error: active.error ? { message: active.error.message } : null,
      data: active.data
        ? {
            profile: active.data.effectiveProfile,
            source: active.data.source,
            hasOverride: active.data.hasOverride,
          }
        : undefined,
    },
    presets: {
      isPending: presets.isPending,
      error: presets.error ? { message: presets.error.message } : null,
      data: presets.data,
    },
    save: (profile: StrategyProfile) => setActive.mutateAsync({ pdno, profile }),
    clear: () => clearActive.mutateAsync({ pdno }),
    saveAsPreset: (name: string, profile: StrategyProfile) =>
      savePreset.mutateAsync({ name, profile }),
    removePreset: (name: string) => deletePreset.mutateAsync({ name }),
    isPending:
      setActive.isPending ||
      clearActive.isPending ||
      savePreset.isPending ||
      deletePreset.isPending,
  };
}

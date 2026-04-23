import { trpc } from '@renderer/shared/api/trpc';
import type { StrategyProfile } from '@shared/contracts';

interface ActiveState {
  isPending: boolean;
  error: { message: string } | null;
  data: { profile: StrategyProfile | null } | undefined;
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
  const active = trpc.strategy.getActive.useQuery({ pdno });
  const presets = trpc.strategy.listPresets.useQuery();

  const invalidateAll = async (): Promise<void> => {
    await Promise.all([
      utils.strategy.getActive.invalidate({ pdno }),
      utils.strategy.listPresets.invalidate(),
      utils.account.getBalanceWithLots.invalidate(),
      ...(pdno !== null ? [utils.account.getPositionOverlay.invalidate({ pdno })] : []),
    ]);
  };

  const setActive = trpc.strategy.setActive.useMutation({ onSuccess: invalidateAll });
  const clearActive = trpc.strategy.clearActive.useMutation({ onSuccess: invalidateAll });
  const savePreset = trpc.strategy.savePreset.useMutation({ onSuccess: invalidateAll });
  const deletePreset = trpc.strategy.deletePreset.useMutation({ onSuccess: invalidateAll });

  return {
    active: {
      isPending: active.isPending,
      error: active.error ? { message: active.error.message } : null,
      data: active.data,
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

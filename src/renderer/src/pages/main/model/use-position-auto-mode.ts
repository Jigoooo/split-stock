import { trpc } from '@renderer/shared/api/trpc';
import type { StrategyAutoMode } from '@shared/contracts/strategy';

interface SetPositionAutoModeInput {
  accountId: number;
  mode: StrategyAutoMode;
  pdno: string;
}

export function usePositionAutoMode(pdno: string) {
  const utils = trpc.useUtils();
  const mutation = trpc.strategy.setAutoModeQuick.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.account.getBalanceWithLots.invalidate(),
        utils.strategy.getActive.invalidate({ pdno }),
        utils.strategy.getEffectiveForEdit.invalidate({ pdno }),
      ]);
    },
  });

  return {
    isPending: mutation.isPending,
    setAutoMode: (input: SetPositionAutoModeInput): void => mutation.mutate(input),
  };
}

import { trpc } from '@renderer/shared/api/trpc';
import { useEffectEvent } from 'react';

export interface UseEditMemoResult {
  save: (content: string) => Promise<boolean>;
  isSaving: boolean;
  lastError: string | null;
}

/**
 * 종목 메모 저장 mutation hook.
 * 저장 성공 시 해당 pdno의 get query를 invalidate한다.
 */
export const useEditMemo = (pdno: string): UseEditMemoResult => {
  const utils = trpc.useUtils();
  const mutation = trpc.symbolMemo.set.useMutation();

  const onSave = useEffectEvent(async (content: string): Promise<boolean> => {
    try {
      await mutation.mutateAsync({ pdno, content });
      await utils.symbolMemo.get.invalidate({ pdno });
      return true;
    } catch {
      return false;
    }
  });

  return {
    save: onSave,
    isSaving: mutation.isPending,
    lastError: mutation.error?.message ?? null,
  };
};

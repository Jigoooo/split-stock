import type { Credentials } from '@shared/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../shared/api/trpc';

/**
 * 자격증명을 저장한 뒤 해당 env로 자동 전환하는 mutation.
 * UI 컴포넌트는 이 hook만 호출하면 되며, 오류는 useMutation 객체로 노출된다.
 */
export const useSaveCredentials = () => {
  const qc = useQueryClient();
  const setCredentials = trpc.auth.setCredentials.useMutation();
  const setEnv = trpc.auth.setEnv.useMutation({
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });

  const save = async (value: Credentials): Promise<void> => {
    await setCredentials.mutateAsync(value);
    await setEnv.mutateAsync(value.env);
  };

  return {
    save,
    isPending: setCredentials.isPending || setEnv.isPending,
    error: setCredentials.error ?? setEnv.error,
  };
};

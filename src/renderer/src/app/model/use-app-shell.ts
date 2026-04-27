import { useKillSwitchHotkey } from '@renderer/features/safety-switch';
import { trpc } from '@renderer/shared/api/trpc';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

type EnvValue = 'MOCK' | 'PROD';

interface UseAppShellReturn {
  env: EnvValue | null;
  stored: Array<{ env: EnvValue; accountNo8: string }>;
  pendingEnv: EnvValue | null;
  isInitializing: boolean;
  isSwitchingEnv: boolean;
  requestEnvSwitch: (next: EnvValue) => void;
  confirmEnvSwitch: (target: EnvValue) => void;
  cancelEnvSwitch: () => void;
}

export function useAppShell(): UseAppShellReturn {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const envQuery = trpc.auth.getEnv.useQuery();
  const storedQuery = trpc.auth.listStored.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const accountsQuery = trpc.account.listAccounts.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const env = envQuery.data?.env ?? null;
  const [pendingEnv, setPendingEnv] = useState<EnvValue | null>(null);

  useKillSwitchHotkey();

  const setEnv = trpc.auth.setEnv.useMutation({
    // 전환 시작 직전 인플라이트 쿼리 전부 취소 — 이전 env 의 accountId 를 담은
    // 쿼리가 KIS 에 도달해 "교차 토큰" 에러 유발하는 레이스 방지.
    onMutate: async () => {
      await queryClient.cancelQueries();
    },
    // 전환 성공 후 모든 쿼리 invalidate — UI 전체가 새 env 기준으로 재조회.
    // await 하면 무거운 query refetch 가 끝날 때까지 isSwitchingEnv=true 가 유지되어 UI 가
    // 길게 disable 됨 → fire-and-forget. 각 useQuery 가 백그라운드에서 자체 refetch 한다.
    onSuccess: () => {
      void utils.invalidate();
    },
    // 실패해도 env 상태 revalidation 은 필요 (서버가 일부 상태만 바꿨을 수 있음).
    onError: () => {
      void utils.auth.getEnv.invalidate();
    },
  });
  const requestEnvSwitch = (next: EnvValue): void => {
    if (next === env) return;
    setPendingEnv(next);
  };

  const confirmEnvSwitch = (target: EnvValue): void => {
    setEnv.mutate(target, {
      onSettled: () => setPendingEnv(null),
    });
  };

  const cancelEnvSwitch = (): void => {
    setPendingEnv(null);
  };

  const stored =
    storedQuery.data?.entries.map((entry) => ({
      env: entry.env,
      accountNo8: entry.accountNo8,
    })) ?? [];

  return {
    env,
    stored,
    pendingEnv,
    isInitializing: envQuery.isPending || storedQuery.isPending || accountsQuery.isPending,
    isSwitchingEnv: setEnv.isPending,
    requestEnvSwitch,
    confirmEnvSwitch,
    cancelEnvSwitch,
  };
}

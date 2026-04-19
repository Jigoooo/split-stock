import { useKillSwitchHotkey } from '@renderer/features/safety-switch';
import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

type EnvValue = 'MOCK' | 'PROD';

interface UseAppShellReturn {
  env: EnvValue | null;
  stored: Array<{ env: EnvValue; accountNo8: string }>;
  pendingEnv: EnvValue | null;
  isInitializing: boolean;
  isSwitchingEnv: boolean;
  isLoggingOut: boolean;
  requestEnvSwitch: (next: EnvValue) => void;
  confirmEnvSwitch: (target: EnvValue) => void;
  cancelEnvSwitch: () => void;
  logout: (clearStored: boolean) => void;
}

export function useAppShell(): UseAppShellReturn {
  const utils = trpc.useUtils();
  const envQuery = trpc.auth.getEnv.useQuery();
  const storedQuery = trpc.auth.listStored.useQuery();
  const env = envQuery.data?.env ?? null;
  const [pendingEnv, setPendingEnv] = useState<EnvValue | null>(null);

  useKillSwitchHotkey();

  const setEnv = trpc.auth.setEnv.useMutation({
    onSuccess: async () => {
      await utils.auth.getEnv.invalidate();
      await utils.account.getBalance.invalidate();
    },
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.getEnv.invalidate();
      await utils.auth.listStored.invalidate();
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

  const logout = (clearStored: boolean): void => {
    const message = clearStored
      ? '저장된 자격증명까지 삭제합니다. 다음에 재로그인 시 App Key/Secret을 다시 입력해야 합니다. 계속할까요?'
      : '현재 환경을 로그아웃합니다. 자격증명은 유지되어 다음에 빠르게 재전환 가능합니다.';
    if (!window.confirm(message)) return;
    logoutMutation.mutate({ clearStored });
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
    isInitializing: envQuery.isPending,
    isSwitchingEnv: setEnv.isPending,
    isLoggingOut: logoutMutation.isPending,
    requestEnvSwitch,
    confirmEnvSwitch,
    cancelEnvSwitch,
    logout,
  };
}

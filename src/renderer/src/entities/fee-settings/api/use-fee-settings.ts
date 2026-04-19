import { trpc } from '../../../shared/api/trpc';
import type { AllFeeSettings, FeeSettings } from '../model/types';

interface UseGetFeeSettingsReturn {
  isPending: boolean;
  error: { message: string } | null;
  data: FeeSettings | undefined;
}

interface UseGetAllFeeSettingsReturn {
  isPending: boolean;
  error: { message: string } | null;
  data: AllFeeSettings | undefined;
}

interface UseUpdateFeeSettingsReturn {
  mutate: (data: { env: 'real' | 'mock'; buy: number; sell: number; tax: number }) => void;
  mutateAsync: (data: {
    env: 'real' | 'mock';
    buy: number;
    sell: number;
    tax: number;
  }) => Promise<FeeSettings>;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 특정 환경의 수수료 설정 조회
 */
export function useGetFeeSettings(env: 'real' | 'mock'): UseGetFeeSettingsReturn {
  const result = trpc.fees.getSettings.useQuery({ env });
  return {
    isPending: result.isPending,
    error: result.error ? { message: result.error.message } : null,
    data: result.data,
  };
}

/**
 * 모든 환경의 수수료 설정 조회
 */
export function useGetAllFeeSettings(): UseGetAllFeeSettingsReturn {
  const result = trpc.fees.getAllSettings.useQuery();
  return {
    isPending: result.isPending,
    error: result.error ? { message: result.error.message } : null,
    data: result.data,
  };
}

/**
 * 수수료 설정 업데이트 mutation
 */
export function useUpdateFeeSettings(): UseUpdateFeeSettingsReturn {
  const mutation = trpc.fees.updateSettings.useMutation();
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

/**
 * 수수료 설정을 기본값으로 초기화 mutation
 */
export function useResetFeeSettings(): UseUpdateFeeSettingsReturn {
  const mutation = trpc.fees.resetToDefaults.useMutation();
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

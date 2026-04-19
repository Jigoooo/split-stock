import { trpc } from '@renderer/shared/api/trpc';
import type { PriceCorrectionSettings, PriceCorrectionStrategy } from '../model/types';

export interface UseGetPriceCorrectionSettingsResult {
  isPending: boolean;
  error: { message: string } | null;
  settings: PriceCorrectionSettings | null;
}

export interface UseUpdatePriceCorrectionSettingsResult {
  mutate: (data: { buy: PriceCorrectionStrategy; sell: PriceCorrectionStrategy }) => void;
  mutateAsync: (data: {
    buy: PriceCorrectionStrategy;
    sell: PriceCorrectionStrategy;
  }) => Promise<{ ok: true }>;
  isPending: boolean;
  error: { message: string } | null;
}

export interface UseResetPriceCorrectionSettingsResult {
  mutate: () => void;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 호가 자동 보정 설정 조회.
 */
export function useGetPriceCorrectionSettings(): UseGetPriceCorrectionSettingsResult {
  const query = trpc.priceCorrection.getSettings.useQuery();
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    settings: query.data ?? null,
  };
}

/**
 * 호가 자동 보정 설정 저장 mutation.
 */
export function useUpdatePriceCorrectionSettings(): UseUpdatePriceCorrectionSettingsResult {
  const mutation = trpc.priceCorrection.updateSettings.useMutation();
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

/**
 * 호가 자동 보정 설정 초기화 mutation.
 */
export function useResetPriceCorrectionSettings(): UseResetPriceCorrectionSettingsResult {
  const mutation = trpc.priceCorrection.resetSettings.useMutation();
  return {
    mutate: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

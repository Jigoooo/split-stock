import { trpc } from '@renderer/shared/api/trpc';
import type { RateGuardSettings } from '../model/types';

export interface UseRateGuardSettingsResult {
  isPending: boolean;
  error: { message: string } | null;
  settings: RateGuardSettings | null;
}

/**
 * 계좌별 rate-guard 설정 조회.
 * accountId가 null이면 빈 결과를 반환한다.
 */
export function useRateGuardSettings(accountId: number | null): UseRateGuardSettingsResult {
  const query = trpc.rateGuard.getSettings.useQuery(
    { accountId: accountId ?? 0 },
    { enabled: accountId !== null },
  );
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    settings: query.data ?? null,
  };
}

import { trpc } from '@renderer/shared/api/trpc';
import type { ProtectionLimits } from '../model/types';

export interface UseGetProtectionLimitsResult {
  isPending: boolean;
  error: { message: string } | null;
  limits: ProtectionLimits | null;
}

export interface UseUpdateProtectionLimitsResult {
  mutate: (data: { accountId: number } & Partial<ProtectionLimits>) => void;
  mutateAsync: (
    data: { accountId: number } & Partial<ProtectionLimits>,
  ) => Promise<{ limits: ProtectionLimits }>;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 계좌별 보호 한도 조회.
 * accountId가 null이면 빈 결과를 반환한다.
 */
export function useGetProtectionLimits(accountId: number | null): UseGetProtectionLimitsResult {
  const query = trpc.protection.get.useQuery(
    { accountId: accountId ?? 0 },
    { enabled: accountId !== null },
  );
  return {
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
    limits: query.data?.limits ?? null,
  };
}

/**
 * 보호 한도 저장 (upsert) mutation.
 */
export function useUpdateProtectionLimits(): UseUpdateProtectionLimitsResult {
  const mutation = trpc.protection.set.useMutation();
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ? { message: mutation.error.message } : null,
  };
}

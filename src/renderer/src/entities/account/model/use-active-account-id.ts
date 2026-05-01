import { trpc } from '@renderer/shared/api/trpc';
import type { AppEnv, BrokerId } from '@shared/contracts';

type ActiveAccount = {
  id: number;
  env: AppEnv;
  broker: BrokerId;
  accountNo8: string;
  accountProdCd: string;
  nickname: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  sortOrder: number;
} | null;

/**
 * 현재 활성 계좌 ID — 거래성 mutation 호출 전에 반드시 명시 전달.
 * 활성 계좌가 없으면 null 반환 — 호출측이 disabled UI 또는 에러 안내.
 */
export function useActiveAccountId(): {
  account: ActiveAccount | null;
  accountId: number | null;
  isPending: boolean;
} {
  const q = trpc.account.getActive.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return {
    account: q.data?.account ?? null,
    accountId: q.data?.accountId ?? null,
    isPending: q.isPending,
  };
}

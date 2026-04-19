import { trpc } from '@renderer/shared/api/trpc';

/**
 * 현재 활성 계좌 ID — 거래성 mutation 호출 전에 반드시 명시 전달.
 * 활성 계좌가 없으면 null 반환 — 호출측이 disabled UI 또는 에러 안내.
 */
export function useActiveAccountId(): { accountId: number | null; isPending: boolean } {
  const q = trpc.account.getActive.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return {
    accountId: q.data?.accountId ?? null,
    isPending: q.isPending,
  };
}

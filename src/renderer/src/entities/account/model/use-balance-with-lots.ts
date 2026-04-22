import { trpc } from '@renderer/shared/api/trpc';
import { useActiveAccountId } from './use-active-account-id';

export interface BalanceWithLotsPosition {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

/** 서버 LotSnapshotEntry 클라이언트 mirror (open/buying lot 항목) */
export interface LotEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: string;
  boughtAt: number; // ms epoch
  soldAt?: number;
  sellPrice?: number;
}

export interface UseBalanceWithLotsResult {
  positions: BalanceWithLotsPosition[];
  deposit: number;
  totalEval: number;
  lotsByPdno: Record<string, LotEntry[]>;
  mismatches: Array<{
    pdno: string;
    kisQty: number;
    lotQty: number;
    reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
  }>;
  syncStatus: 'IN_SYNC' | 'MISMATCH';
  strategiesByPdno: Record<string, { maxStages: number }>;
  isPending: boolean;
  error: { message: string } | null;
}

/**
 * 잔고 + 차수(lots) + 종목별 전략 메타를 1-roundtrip 으로 합성.
 * accountId 는 useActiveAccountId 로 자동 주입.
 * 활성 계좌가 없으면 쿼리 disabled.
 */
export function useBalanceWithLots(): UseBalanceWithLotsResult {
  const { accountId } = useActiveAccountId();

  const query = trpc.account.getBalanceWithLots.useQuery(
    accountId !== null ? { accountId } : undefined,
    { enabled: accountId !== null, refetchInterval: 3000, staleTime: 0 },
  );

  return {
    positions: query.data?.positions ?? [],
    deposit: query.data?.deposit ?? 0,
    totalEval: query.data?.totalEval ?? 0,
    lotsByPdno: (query.data?.lotsByPdno ?? {}) as Record<string, LotEntry[]>,
    mismatches: query.data?.mismatches ?? [],
    syncStatus: (query.data?.syncStatus ?? 'IN_SYNC') as 'IN_SYNC' | 'MISMATCH',
    strategiesByPdno: query.data?.strategiesByPdno ?? {},
    isPending: query.isPending,
    error: query.error ? { message: query.error.message } : null,
  };
}

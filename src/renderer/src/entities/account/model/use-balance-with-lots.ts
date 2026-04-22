import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useMemo, useState } from 'react';
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

interface BalanceWithLotsSnapshot {
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
}

function readCachedSnapshot(accountId: number | null): BalanceWithLotsSnapshot | null {
  if (accountId === null || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`split-stock.balance-with-lots.${accountId}`);
    if (!raw) return null;
    return JSON.parse(raw) as BalanceWithLotsSnapshot;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(accountId: number | null, data: BalanceWithLotsSnapshot): void {
  if (accountId === null || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`split-stock.balance-with-lots.${accountId}`, JSON.stringify(data));
  } catch {
    // ignore quota/localStorage failures
  }
}

/**
 * 잔고 + 차수(lots) + 종목별 전략 메타를 1-roundtrip 으로 합성.
 * accountId 는 useActiveAccountId 로 자동 주입.
 * 활성 계좌가 없으면 쿼리 disabled.
 */
export function useBalanceWithLots(): UseBalanceWithLotsResult {
  const { accountId } = useActiveAccountId();
  const cachedSnapshot = useMemo(() => readCachedSnapshot(accountId), [accountId]);
  const [queryReady, setQueryReady] = useState(accountId !== null && cachedSnapshot === null);

  useEffect(() => {
    if (accountId === null) {
      setQueryReady(false);
      return;
    }
    if (cachedSnapshot === null) {
      setQueryReady(true);
      return;
    }
    setQueryReady(false);
    const id = window.setTimeout(() => setQueryReady(true), 250);
    return () => window.clearTimeout(id);
  }, [accountId, cachedSnapshot]);

  const query = trpc.account.getBalanceWithLots.useQuery(
    accountId !== null ? { accountId } : undefined,
    { enabled: accountId !== null && queryReady, refetchInterval: 4000, staleTime: 0 },
  );
  const data = (query.data as BalanceWithLotsSnapshot | undefined) ?? cachedSnapshot;

  useEffect(() => {
    if (!query.data) return;
    writeCachedSnapshot(accountId, query.data as BalanceWithLotsSnapshot);
  }, [accountId, query.data]);

  return {
    positions: data?.positions ?? [],
    deposit: data?.deposit ?? 0,
    totalEval: data?.totalEval ?? 0,
    lotsByPdno: (data?.lotsByPdno ?? {}) as Record<string, LotEntry[]>,
    mismatches: data?.mismatches ?? [],
    syncStatus: (data?.syncStatus ?? 'IN_SYNC') as 'IN_SYNC' | 'MISMATCH',
    strategiesByPdno: data?.strategiesByPdno ?? {},
    isPending: query.isPending && cachedSnapshot === null,
    error: query.error ? { message: query.error.message } : null,
  };
}

import { useLiveTicks } from '@renderer/entities/realtime';
import { trpc } from '@renderer/shared/api/trpc';
import { skipToken } from '@tanstack/react-query';
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

export interface BalanceWithLotsStrategyMeta {
  maxStages: number;
  autoBuyEnabled: boolean;
  autoSellEnabled: boolean;
}

export interface BalanceWithLotsSummary {
  deposit: number;
  d2Deposit: number;
  totalBuyAmount: number;
  totalEval: number;
  totalPnlAmount: number;
  totalPnlRate: number;
  estimatedAsset: number;
}

export interface UseBalanceWithLotsResult {
  positions: BalanceWithLotsPosition[];
  deposit: number;
  d2Deposit: number;
  totalEval: number;
  estimatedAsset: number;
  totalBuyAmount: number;
  totalPnlAmount: number;
  totalPnlRate: number;
  summary: BalanceWithLotsSummary;
  lotsByPdno: Record<string, LotEntry[]>;
  mismatches: Array<{
    pdno: string;
    kisQty: number;
    lotQty: number;
    reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
  }>;
  syncStatus: 'IN_SYNC' | 'MISMATCH';
  strategiesByPdno: Record<string, BalanceWithLotsStrategyMeta>;
  isPending: boolean;
  error: { message: string } | null;
}

export interface BalanceWithLotsSnapshot {
  positions: BalanceWithLotsPosition[];
  deposit: number;
  d2Deposit: number;
  totalEval: number;
  estimatedAsset: number;
  totalBuyAmount: number;
  totalPnlAmount: number;
  totalPnlRate: number;
  lotsByPdno: Record<string, LotEntry[]>;
  mismatches: Array<{
    pdno: string;
    kisQty: number;
    lotQty: number;
    reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
  }>;
  syncStatus: 'IN_SYNC' | 'MISMATCH';
  strategiesByPdno: Record<string, BalanceWithLotsStrategyMeta>;
}

interface LatestPriceLike {
  price: number;
}

export function applyLiveTicksToBalanceSnapshot(
  snapshot: BalanceWithLotsSnapshot | null | undefined,
  latestTicks: Record<string, LatestPriceLike | null | undefined>,
): BalanceWithLotsSnapshot | null | undefined {
  if (!snapshot) return snapshot;

  let changed = false;
  const positions = snapshot.positions.map((position) => {
    const livePrice = latestTicks[position.code]?.price;
    if (
      typeof livePrice !== 'number' ||
      !Number.isFinite(livePrice) ||
      livePrice <= 0 ||
      livePrice === position.currentPrice
    ) {
      return position;
    }

    changed = true;
    const evalAmount = position.qty * livePrice;
    const buyAmount = position.qty * position.avgPrice;
    const pnlAmount = evalAmount - buyAmount;
    const pnlRate = buyAmount > 0 ? (pnlAmount / buyAmount) * 100 : 0;
    return {
      ...position,
      currentPrice: livePrice,
      evalAmount,
      pnlAmount,
      pnlRate,
    };
  });

  if (!changed) return snapshot;

  const previousEval = snapshot.positions.reduce((sum, position) => sum + position.evalAmount, 0);
  const totalBuyAmount = positions.reduce(
    (sum, position) => sum + position.qty * position.avgPrice,
    0,
  );
  const totalEval = positions.reduce((sum, position) => sum + position.evalAmount, 0);
  const totalPnlAmount = positions.reduce((sum, position) => sum + position.pnlAmount, 0);
  const totalPnlRate = totalBuyAmount > 0 ? (totalPnlAmount / totalBuyAmount) * 100 : 0;

  return {
    ...snapshot,
    positions,
    totalBuyAmount,
    totalEval,
    totalPnlAmount,
    totalPnlRate,
    estimatedAsset: snapshot.estimatedAsset + (totalEval - previousEval),
  };
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
  const [consecutiveFailureCount, setConsecutiveFailureCount] = useState(0);

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
    {
      enabled: accountId !== null && queryReady,
      refetchInterval: 4000,
      staleTime: 0,
    },
  );
  const rawData = (query.data as BalanceWithLotsSnapshot | undefined) ?? cachedSnapshot;
  const livePdnos = useMemo(
    () => (rawData?.positions ?? []).map((position) => position.code).sort(),
    [rawData?.positions],
  );
  const latestTicks = useLiveTicks(livePdnos, 1000);
  const data = useMemo(
    () => applyLiveTicksToBalanceSnapshot(rawData, latestTicks),
    [rawData, latestTicks],
  );
  const strategyPdnos = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set([
        ...data.positions.map((position) => position.code),
        ...Object.keys(data.lotsByPdno),
      ]),
    ).sort((a, b) => a.localeCompare(b));
  }, [data]);
  const strategyMetaQuery = trpc.strategy.getEffectiveMetas.useQuery(
    accountId !== null && strategyPdnos.length > 0
      ? { accountId, pdnos: strategyPdnos }
      : skipToken,
    {
      enabled: accountId !== null && strategyPdnos.length > 0,
      staleTime: 0,
    },
  );

  useEffect(() => {
    if (!query.data) return;
    setConsecutiveFailureCount(0);
    writeCachedSnapshot(accountId, query.data as BalanceWithLotsSnapshot);
  }, [accountId, query.data]);

  useEffect(() => {
    if (query.errorUpdatedAt === 0 || !query.error) return;
    setConsecutiveFailureCount((count) => count + 1);
  }, [query.error, query.errorUpdatedAt]);

  const summary: BalanceWithLotsSummary = {
    deposit: data?.deposit ?? 0,
    d2Deposit: data?.d2Deposit ?? 0,
    totalBuyAmount: data?.totalBuyAmount ?? 0,
    totalEval: data?.totalEval ?? 0,
    totalPnlAmount: data?.totalPnlAmount ?? 0,
    totalPnlRate: data?.totalPnlRate ?? 0,
    estimatedAsset: data?.estimatedAsset ?? 0,
  };
  const hideTransientError = query.error !== null && consecutiveFailureCount < 3;

  return {
    positions: data?.positions ?? [],
    deposit: summary.deposit,
    d2Deposit: summary.d2Deposit,
    totalEval: summary.totalEval,
    estimatedAsset: summary.estimatedAsset,
    totalBuyAmount: summary.totalBuyAmount,
    totalPnlAmount: summary.totalPnlAmount,
    totalPnlRate: summary.totalPnlRate,
    summary,
    lotsByPdno: (data?.lotsByPdno ?? {}) as Record<string, LotEntry[]>,
    mismatches: data?.mismatches ?? [],
    syncStatus: (data?.syncStatus ?? 'IN_SYNC') as 'IN_SYNC' | 'MISMATCH',
    strategiesByPdno:
      strategyMetaQuery.data?.strategiesByPdno ??
      (strategyPdnos.length > 0 ? {} : (data?.strategiesByPdno ?? {})),
    isPending: (query.isPending && cachedSnapshot === null) || (hideTransientError && data == null),
    error: query.error && !hideTransientError ? { message: query.error.message } : null,
  };
}

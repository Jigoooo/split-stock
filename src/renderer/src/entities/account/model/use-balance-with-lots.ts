import { useLiveTicks } from '@renderer/entities/realtime';
import { trpc } from '@renderer/shared/api/trpc';
import { isCryptoBroker, QUOTE_CURRENCIES } from '@shared/contracts';
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

export type LotSyncStatus = 'IN_SYNC' | 'RECONCILING' | 'MISMATCH';

export interface LotSyncMismatch {
  pdno: string;
  kisQty: number;
  lotQty: number;
  reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
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
  mismatches: LotSyncMismatch[];
  pendingMismatches: LotSyncMismatch[];
  syncStatus: LotSyncStatus;
  brokerLabel: string;
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
  mismatches: LotSyncMismatch[];
  pendingMismatches?: LotSyncMismatch[];
  syncStatus: LotSyncStatus;
  brokerLabel?: string;
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

/** UPBIT DecimalString → number (NaN/null 안전). */
function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
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
 *
 * Phase R2: broker 인자 (default 'KIS').
 * UPBIT (broker='UPBIT' 또는 active account 가 UPBIT) 는 backend stock handler 가
 * KIS 하드코딩이라 호출 시 UNAUTHORIZED 만 떨어진다 — 쿼리를 disable 하고 코인 잔고는
 * entities/account-crypto + crypto.getBalances 에 위임. (Phase R3-3 backend 분기까지)
 */
export function useBalanceWithLots(broker?: string): UseBalanceWithLotsResult {
  const { account, accountId } = useActiveAccountId();
  // UPBIT 모드: stock 잔고 핸들러가 KIS 하드코딩이라 직접 호출하면 UNAUTHORIZED 만 떨어진다.
  // 대신 crypto.getBalances 로 fetch 해서 동일한 BalanceWithLotsSnapshot shape 으로 변환.
  const isUpbitMode = isCryptoBroker(broker) || isCryptoBroker(account?.broker);
  const stockBalanceEnabled = accountId !== null && !isUpbitMode;
  const stockAccountId = stockBalanceEnabled ? accountId : null;
  const cachedSnapshot = useMemo(
    () => (stockAccountId !== null ? readCachedSnapshot(stockAccountId) : null),
    [stockAccountId],
  );
  const [queryReady, setQueryReady] = useState(stockBalanceEnabled && cachedSnapshot === null);
  const [consecutiveFailureCount, setConsecutiveFailureCount] = useState(0);

  useEffect(() => {
    if (!stockBalanceEnabled) {
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
  }, [cachedSnapshot, stockBalanceEnabled]);

  const query = trpc.account.getBalanceWithLots.useQuery(
    stockAccountId !== null
      ? { accountId: stockAccountId, ...(broker !== undefined ? { broker } : {}) }
      : skipToken,
    {
      enabled: stockBalanceEnabled && queryReady,
      // UNAUTHORIZED (자격증명 미로그인 / env mismatch) 는 retry/refetch 가 무의미.
      // 로그인 전까지 매 4초 폴링 → 에러 chip 깜박임의 원인이라 중단.
      refetchInterval: (q) => (isUnauthorizedTrpcError(q.state.error) ? false : 4000),
      retry: (failureCount, error) => !isUnauthorizedTrpcError(error) && failureCount < 3,
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
    stockAccountId !== null && strategyPdnos.length > 0
      ? { accountId: stockAccountId, pdnos: strategyPdnos }
      : skipToken,
    {
      enabled: stockAccountId !== null && strategyPdnos.length > 0,
      staleTime: 0,
    },
  );
  const cryptoBalancesQuery = trpc.crypto.getBalances.useQuery(
    isUpbitMode && accountId !== null ? { accountId } : skipToken,
    {
      enabled: isUpbitMode && accountId !== null,
      refetchInterval: (q) => (isUnauthorizedTrpcError(q.state.error) ? false : 4000),
      retry: (failureCount, error) => !isUnauthorizedTrpcError(error) && failureCount < 3,
      staleTime: 0,
    },
  );
  // NM-017: UPBIT 잔고 보유 마켓에 대해 ticker batch 조회. 1 batch API call / 3초.
  const upbitMarkets = useMemo(() => {
    if (!isUpbitMode) return [] as string[];
    const balances = cryptoBalancesQuery.data?.balances ?? [];
    return balances
      .filter(
        (b) => b.currency !== QUOTE_CURRENCIES.KRW && Number(b.balance) + Number(b.locked) > 0,
      )
      .map((b) => `${b.unitCurrency || 'KRW'}-${b.currency}`)
      .sort();
  }, [cryptoBalancesQuery.data?.balances, isUpbitMode]);
  const upbitTickersQuery = trpc.crypto.getTickers.useQuery(
    upbitMarkets.length > 0 ? { markets: upbitMarkets } : skipToken,
    {
      enabled: isUpbitMode && upbitMarkets.length > 0,
      refetchInterval: 3000,
      staleTime: 1000,
    },
  );

  useEffect(() => {
    if (!query.data) return;
    setConsecutiveFailureCount(0);
    writeCachedSnapshot(stockAccountId, query.data as BalanceWithLotsSnapshot);
  }, [query.data, stockAccountId]);

  useEffect(() => {
    if (query.errorUpdatedAt === 0 || !query.error) return;
    // UNAUTHORIZED 는 사용자 액션 (로그인) 이 있어야 풀리는 정상 상태 — failure 카운트를
    // 누적해서 chip 으로 표시할 필요가 없다.
    if (isUnauthorizedTrpcError(query.error)) return;
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
  const isUnauthorized = isUnauthorizedTrpcError(query.error);

  if (isUpbitMode) {
    const balances = cryptoBalancesQuery.data?.balances ?? [];
    const krw = balances.find((b) => b.currency === QUOTE_CURRENCIES.KRW);
    // NM-017: ticker batch 결과를 market → tradePrice map 으로 변환
    const tickerMap = new Map<string, number>();
    for (const t of upbitTickersQuery.data?.tickers ?? []) {
      tickerMap.set(t.market, num(t.tradePrice));
    }
    const upbitPositions: BalanceWithLotsPosition[] = balances
      .filter((b) => b.currency !== 'KRW')
      .map((b) => {
        // balance 는 거래가능, locked 는 주문대기 — 둘 다 보유 수량
        const qty = num(b.balance) + num(b.locked);
        const avgPrice = num(b.avgBuyPrice);
        const code = `${b.unitCurrency || 'KRW'}-${b.currency}`;
        // NM-017: ticker map 에서 현재가 lookup. 미응답 시 avgPrice fallback (pnl=0).
        const tickerPrice = tickerMap.get(code);
        const currentPrice = tickerPrice && tickerPrice > 0 ? tickerPrice : avgPrice;
        const evalAmount = qty * currentPrice;
        const buyAmount = qty * avgPrice;
        const pnlAmount = evalAmount - buyAmount;
        const pnlRate = buyAmount > 0 ? pnlAmount / buyAmount : 0;
        return {
          code,
          name: b.currency,
          qty,
          avgPrice,
          currentPrice,
          evalAmount,
          pnlAmount,
          pnlRate,
        };
      })
      .filter((p) => p.qty > 0);
    const upbitTotalEval = upbitPositions.reduce((sum, p) => sum + p.evalAmount, 0);
    const upbitTotalBuyAmount = upbitPositions.reduce((sum, p) => sum + p.qty * p.avgPrice, 0);
    const upbitTotalPnlAmount = upbitTotalEval - upbitTotalBuyAmount;
    const upbitTotalPnlRate =
      upbitTotalBuyAmount > 0 ? upbitTotalPnlAmount / upbitTotalBuyAmount : 0;
    const upbitDeposit = num(krw?.balance);
    const upbitSummary: BalanceWithLotsSummary = {
      deposit: upbitDeposit,
      d2Deposit: upbitDeposit,
      totalBuyAmount: upbitTotalBuyAmount,
      totalEval: upbitTotalEval,
      totalPnlAmount: upbitTotalPnlAmount,
      totalPnlRate: upbitTotalPnlRate,
      estimatedAsset: upbitDeposit + upbitTotalEval,
    };
    const upbitUnauthorized = isUnauthorizedTrpcError(cryptoBalancesQuery.error);
    return {
      positions: upbitPositions,
      deposit: upbitSummary.deposit,
      d2Deposit: upbitSummary.d2Deposit,
      totalEval: upbitSummary.totalEval,
      estimatedAsset: upbitSummary.estimatedAsset,
      totalBuyAmount: upbitSummary.totalBuyAmount,
      totalPnlAmount: upbitSummary.totalPnlAmount,
      totalPnlRate: upbitSummary.totalPnlRate,
      summary: upbitSummary,
      lotsByPdno: {},
      mismatches: [],
      pendingMismatches: [],
      syncStatus: 'IN_SYNC',
      brokerLabel: 'UPBIT',
      strategiesByPdno: {},
      isPending: cryptoBalancesQuery.isPending && cryptoBalancesQuery.fetchStatus !== 'idle',
      error:
        cryptoBalancesQuery.error && !upbitUnauthorized
          ? { message: cryptoBalancesQuery.error.message }
          : null,
    };
  }

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
    pendingMismatches: data?.pendingMismatches ?? [],
    syncStatus: (data?.syncStatus ?? 'IN_SYNC') as LotSyncStatus,
    brokerLabel: data?.brokerLabel ?? 'KIS',
    strategiesByPdno:
      strategyMetaQuery.data?.strategiesByPdno ??
      (strategyPdnos.length > 0 ? {} : (data?.strategiesByPdno ?? {})),
    // 쿼리가 disabled (UPBIT 등) 면 query.isPending 이 영구 true 라 "로드 중…" 에서 멈춘다.
    // stockBalanceEnabled 가 false 면 더 이상 로드가 일어나지 않는다는 뜻이므로 isPending=false.
    isPending:
      stockBalanceEnabled &&
      ((query.isPending && cachedSnapshot === null) || (hideTransientError && data == null)),
    error:
      query.error && !hideTransientError && !isUnauthorized
        ? { message: query.error.message }
        : null,
  };
}

/**
 * UNAUTHORIZED (자격증명 미로그인 / env mismatch) 판별. 백엔드 [account-balance-handlers.ts]
 * 의 `'자격증명 없음 — 로그인 필요'` TRPCError 가 retry/refetch 로 깜박이며 alert chip 으로
 * 노출되는 것을 막기 위한 진단. trpc client error 의 `data.code` 를 우선 검사하고, shape
 * 누락 시 메시지 prefix 로 fallback.
 */
function isUnauthorizedTrpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { data?: { code?: unknown } }).data;
  if (data && typeof data === 'object' && data.code === 'UNAUTHORIZED') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.startsWith('자격증명 없음');
}

import { buildLotOverlay, type LotOverlaySnapshot } from '@shared/trading/lot-overlay';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { lots as lotsTable } from '../../db/schema';
import { buildLotSyncState } from '../../trading/current-state-sync';
import type { LotStatus } from '../../trading/fsm';
import type { LotSnapshotEntry } from '../../trading/lots-repo';
import type { Context } from '../context';
import { resolveAccountId } from '../router-helpers';
import {
  balanceErrorMessage,
  readRecentSellOrderPdnos,
  serializeCause,
  toLegacyBalance,
  toLegacyKisError,
} from './account-shared';

const STOCK_BROKER = 'KIS';

export async function getBalanceHandler(
  ctx: Context,
  input: { accountId?: number | undefined; broker?: string | undefined } = {},
) {
  const { accountId, balance, broker, env } = await fetchLegacyBalance(ctx, input, {
    logMessage: 'account.getBalance.failed',
  });
  void accountId;
  void env;
  void broker;
  return balance.value;
}

export async function getBalanceWithLotsHandler(
  ctx: Context,
  input: { accountId?: number | undefined; broker?: string | undefined } = {},
) {
  const { accountId, balance, broker } = await fetchLegacyBalance(ctx, input, {
    logMessage: 'account.getBalanceWithLots.failed',
  });
  const brokerKey = input.broker ?? STOCK_BROKER;
  const lotsByPdno = readLotsByPdno(ctx, accountId, brokerKey);
  const strategiesByPdno = readStrategiesByPdno(
    ctx,
    accountId,
    balance.value.positions,
    lotsByPdno,
  );
  const recentSellOrderPdnos = readRecentSellOrderPdnos(ctx.db, accountId, brokerKey);
  const syncState = buildLotSyncState({
    positions: balance.value.positions.map((position) => ({
      code: position.code,
      qty: position.qty,
    })),
    lotsByPdno,
    recentSellOrderPdnos,
  });
  const totalBuyAmount = balance.value.positions.reduce(
    (sum, position) => sum + position.qty * position.avgPrice,
    0,
  );
  const totalPnlAmount = balance.value.positions.reduce(
    (sum, position) => sum + position.pnlAmount,
    0,
  );
  const totalPnlRate = totalBuyAmount > 0 ? (totalPnlAmount / totalBuyAmount) * 100 : 0;
  return {
    positions: balance.value.positions,
    deposit: balance.value.deposit,
    d2Deposit: balance.value.d2Deposit,
    totalEval: balance.value.totalEval,
    estimatedAsset: balance.value.estimatedAsset,
    totalBuyAmount,
    totalPnlAmount,
    totalPnlRate,
    lotsByPdno,
    syncStatus: syncState.syncStatus,
    mismatches: syncState.mismatches,
    pendingMismatches: syncState.pendingMismatches,
    brokerLabel: broker.brokerId,
    strategiesByPdno,
  };
}

export function getPositionOverlayHandler(
  ctx: Context,
  input: {
    pdno: string;
    accountId?: number | undefined;
    broker?: string | undefined;
    includeSold: boolean;
  },
) {
  const accountId = resolveAccountId(ctx, input);
  const brokerKey = input.broker ?? STOCK_BROKER;
  const snap = ctx.lotsRepo.snapshot(accountId, input.pdno, brokerKey);
  if (snap.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `차수 조회 실패: ${snap.error.kind}`,
    });
  }
  const active = ctx.strategyRepo.getActive(accountId, input.pdno);
  const globalActive = ctx.strategyRepo.getActive(accountId, null);
  const profile =
    (active.isOk() ? active.value : null) ?? (globalActive.isOk() ? globalActive.value : null);
  const profitPctByNth: Record<number, number> = {};
  for (const rule of profile?.sellRules ?? []) {
    profitPctByNth[rule.nth] = rule.targetProfitPct;
  }
  const overlay: LotOverlaySnapshot[] = snap.value.lots.map((l) => ({
    nth: l.nth,
    buyPrice: l.buyPrice,
    qty: l.qty,
    status: l.status,
  }));
  const lines = buildLotOverlay(overlay, {
    profitPctByNth,
    fallbackProfitPct: 0.05,
    includeSold: input.includeSold,
  });
  return { lines, profitPctByNth };
}

async function fetchLegacyBalance(
  ctx: Context,
  input: { accountId?: number | undefined },
  opts: { logMessage: string },
) {
  const env = ctx.currentEnv;
  if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
  const accountId = resolveAccountId(ctx, input);
  const broker = ctx.brokerForAccount(accountId);
  if (!broker) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: '자격증명 없음 — 로그인 필요',
    });
  }
  let balanceR = await broker.inquireBalance();
  if (
    balanceR.isErr() &&
    (balanceR.error.kind === 'AUTH_FAILED' || balanceR.error.raw?.subCode === 'EGW00123')
  ) {
    broker.invalidateSession();
    const ensured = await broker.ensureSession({ forceRefresh: true });
    if (ensured.isOk()) {
      balanceR = await broker.inquireBalance();
    }
  }
  if (balanceR.isErr()) {
    const legacy = toLegacyKisError(balanceR.error);
    ctx.logger.log({
      level: 'ERROR',
      category: 'SYS',
      message: opts.logMessage,
      payload: {
        accountId,
        env,
        brokerId: broker.brokerId,
        kind: legacy.kind,
        kisMsg: legacy.msg,
        rt_cd: legacy.rt_cd,
        msg_cd: legacy.msg_cd,
        cause: serializeCause(legacy.cause),
      },
    });
    throw new TRPCError({
      code: legacy.kind === 'AUTH_FAILED' ? 'UNAUTHORIZED' : 'INTERNAL_SERVER_ERROR',
      message: balanceErrorMessage(legacy),
    });
  }
  return {
    accountId,
    balance: { value: toLegacyBalance(balanceR.value) },
    broker,
    env,
  };
}

function readLotsByPdno(
  ctx: Context,
  accountId: number,
  broker: string = STOCK_BROKER,
): Record<string, LotSnapshotEntry[]> {
  let lotsByPdno: Record<string, LotSnapshotEntry[]> = {};
  try {
    const lotRows = ctx.db
      .select()
      .from(lotsTable)
      .where(
        and(
          eq(lotsTable.broker, broker),
          eq(lotsTable.accountId, accountId),
          inArray(lotsTable.status, ['OPEN', 'BUYING', 'SELLING']),
        ),
      )
      .all();
    for (const r of lotRows) {
      const entry: LotSnapshotEntry = {
        nth: r.nth,
        buyPrice: r.buyPrice,
        qty: r.qty,
        amountKrw: r.amountKrw,
        status: r.status as LotStatus,
        boughtAt: r.boughtAt instanceof Date ? r.boughtAt.getTime() : Number(r.boughtAt),
      };
      const soldAtMs =
        r.soldAt === null
          ? undefined
          : r.soldAt instanceof Date
            ? r.soldAt.getTime()
            : Number(r.soldAt);
      if (soldAtMs !== undefined) entry.soldAt = soldAtMs;
      if (r.sellPrice !== null) entry.sellPrice = r.sellPrice;
      const list = lotsByPdno[r.pdno] ?? [];
      list.push(entry);
      lotsByPdno[r.pdno] = list;
    }
  } catch (err) {
    ctx.logger.log({
      level: 'ERROR',
      category: 'SYS',
      message: 'getBalanceWithLots: lots DB 조회 실패 — 빈 lots 로 fallback',
      payload: { accountId, err: String(err) },
    });
    lotsByPdno = {};
  }
  return lotsByPdno;
}

function readStrategiesByPdno(
  ctx: Context,
  accountId: number,
  positions: Array<{ code: string }>,
  lotsByPdno: Record<string, LotSnapshotEntry[]>,
): Record<string, { maxStages: number; autoBuyEnabled: boolean; autoSellEnabled: boolean }> {
  let strategiesByPdno: Record<
    string,
    { maxStages: number; autoBuyEnabled: boolean; autoSellEnabled: boolean }
  > = {};
  try {
    const globalActive = ctx.strategyRepo.getActive(accountId, null);
    const globalProfile = globalActive.isOk() ? globalActive.value : null;
    const allPdnos = new Set<string>([...positions.map((p) => p.code), ...Object.keys(lotsByPdno)]);
    for (const pdno of allPdnos) {
      const perSymbol = ctx.strategyRepo.getActive(accountId, pdno);
      const profile =
        perSymbol.isOk() && perSymbol.value !== null ? perSymbol.value : globalProfile;
      if (profile !== null) {
        strategiesByPdno[pdno] = {
          maxStages: profile.maxStages,
          autoBuyEnabled: profile.autoBuyEnabled,
          autoSellEnabled: profile.autoSellEnabled,
        };
      }
    }
  } catch (err) {
    ctx.logger.log({
      level: 'ERROR',
      category: 'SYS',
      message: 'getBalanceWithLots: strategy 조회 실패 — 빈 strategies 로 fallback',
      payload: { accountId, err: String(err) },
    });
    strategiesByPdno = {};
  }
  return strategiesByPdno;
}

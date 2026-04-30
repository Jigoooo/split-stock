import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { eventLogs, watchOrders } from '../../db/schema';
import { readWatchGlobalEnabled, watchGlobalEnabledKey } from '../../db/settings-repo';
import type { EventLogger } from '../../logging/event-logger';
import type { Context } from '../context';

type WatchStatus = 'WATCHING' | 'PAUSED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
type WatchSource = 'BOOSTER' | 'PREBUY' | 'CUSTOM';

interface WatchListInput {
  status?: WatchStatus | undefined;
  source?: WatchSource | undefined;
  accountId?: number | undefined;
}

interface AccountScopedInput {
  accountId?: number | undefined;
}

interface SetGlobalEnabledInput extends AccountScopedInput {
  enabled: boolean;
}

interface IdInput {
  id: number;
}

interface ReservationBuyCreateInput {
  accountId: number;
  pdno: string;
  targetPrice: number;
  orderType: 'MARKET' | 'LIMIT';
  qtyOrAmountMode: 'QTY' | 'AMOUNT';
  qty?: number | undefined;
  amountKrw?: number | undefined;
  expiresAt?: number | Date | undefined;
}

interface ReservationBuyUpdateInput extends Omit<ReservationBuyCreateInput, 'accountId'> {
  id: number;
}

interface WatchHistoryInput {
  limit?: number | undefined;
}

interface WatchHistoryItem {
  id: number;
  at: Date;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  accountId: number;
  pdno: string | null;
  source: 'PREBUY' | 'CUSTOM' | null;
  watchId: number | null;
  reason: string | null;
}

function ensureWatchEngine(ctx: Context): NonNullable<Context['watchEngine']> {
  if (!ctx.watchEngine) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'watchEngine이 초기화되지 않음',
    });
  }
  return ctx.watchEngine;
}

function ensureActiveAccountId(activeAccountId: number | null): number {
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다. 자격증명을 먼저 등록하세요.',
    });
  }
  return activeAccountId;
}

function ensureRequestedAccount(
  activeAccountId: number,
  requestedAccountId: number | undefined,
  forbiddenMessage: string,
): number {
  const accountId = requestedAccountId ?? activeAccountId;
  if (accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: forbiddenMessage,
    });
  }
  return accountId;
}

function logWatchEvent(
  ctx: { logger?: EventLogger },
  event: {
    level: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    accountId: number;
    watchId: number;
    pdno: string;
    source: string;
    reason?: string | null;
  },
): void {
  ctx.logger?.log({
    level: event.level,
    category: 'WATCH',
    message: event.message,
    payload: {
      accountId: event.accountId,
      watchId: event.watchId,
      pdno: event.pdno,
      source: event.source,
      reason: event.reason ?? null,
    },
  });
}

function getOwnedWatchOrder(ctx: Context, id: number, activeAccountId: number) {
  const owned = ctx.db
    .select()
    .from(watchOrders)
    .where(and(eq(watchOrders.id, id), eq(watchOrders.accountId, activeAccountId)))
    .get();
  if (!owned) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: '해당 자동감시주문을 찾을 수 없습니다.',
    });
  }
  return owned;
}

export function listWatchOrders(ctx: Context, input: WatchListInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== undefined && input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌의 자동감시주문은 조회할 수 없습니다.',
    });
  }
  return {
    orders: watchEngine
      .list({
        status: input.status,
        source: input.source,
        accountId: activeAccountId,
      })
      .filter((order) => order.source !== 'BOOSTER'),
  };
}

export function getWatchControlState(ctx: Context, input: AccountScopedInput | undefined) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const accountId = ensureRequestedAccount(
    activeAccountId,
    input?.accountId,
    '다른 계좌의 자동감시 상태는 조회할 수 없습니다.',
  );
  const orders = watchEngine.list({ accountId });
  const watchingCount = orders.filter((order) => order.status === 'WATCHING').length;
  const pausedCount = orders.filter((order) => order.status === 'PAUSED').length;
  return {
    globalEnabled: readWatchGlobalEnabled(ctx.settingsRepo, accountId),
    watchingCount,
    pausedCount,
    totalTrackedCount: watchingCount + pausedCount,
  };
}

export function setWatchGlobalEnabled(ctx: Context, input: SetGlobalEnabledInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const accountId = ensureRequestedAccount(
    activeAccountId,
    input.accountId,
    '다른 계좌의 자동감시 상태는 변경할 수 없습니다.',
  );
  ctx.settingsRepo.set(watchGlobalEnabledKey(accountId), input.enabled ? 'true' : 'false');
  watchEngine.setGlobalEnabled(accountId, input.enabled);
  ctx.logger.log({
    level: 'INFO',
    category: 'WATCH',
    message: `watch.global.${input.enabled ? 'on' : 'off'}`,
    payload: { accountId },
  });
  return { globalEnabled: input.enabled };
}

export function pauseWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  const result = watchEngine.pause(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `일시중지 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.paused',
    accountId: owned.accountId,
    watchId: owned.id,
    pdno: owned.pdno,
    source: owned.source,
  });
  return { ok: true as const };
}

export function resumeWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  getOwnedWatchOrder(ctx, input.id, activeAccountId);
  const result = watchEngine.resume(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `재개 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.resumed',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

export function cancelWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  if (owned.source === 'PREBUY' && owned.sourceRefId) {
    const prebuyId = Number(owned.sourceRefId);
    if (Number.isInteger(prebuyId) && prebuyId > 0) {
      ctx.prebuyRepo.cancel(prebuyId);
    }
  }
  const result = watchEngine.cancel(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `취소 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.cancelled',
    accountId: owned.accountId,
    watchId: owned.id,
    pdno: owned.pdno,
    source: owned.source,
  });
  return { ok: true as const };
}

export function createReservationBuyWatchOrder(ctx: Context, input: ReservationBuyCreateInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌로의 자동감시주문 등록은 허용되지 않습니다.',
    });
  }
  const result = watchEngine.register({
    accountId: input.accountId,
    pdno: input.pdno,
    source: 'CUSTOM',
    side: 'BUY',
    targetPrice: input.targetPrice,
    comparator: 'LTE',
    orderType: input.orderType,
    qtyOrAmountMode: input.qtyOrAmountMode,
    ...(input.qtyOrAmountMode === 'QTY' ? { qty: input.qty as number } : {}),
    ...(input.qtyOrAmountMode === 'AMOUNT' ? { amountKrw: input.amountKrw as number } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
      message: `등록 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.created',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

export function updateReservationBuyWatchOrder(ctx: Context, input: ReservationBuyUpdateInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  if (owned.source !== 'CUSTOM') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '수동 예약매수만 수정할 수 있습니다.',
    });
  }
  const result = watchEngine.update(input.id, {
    accountId: activeAccountId,
    pdno: input.pdno,
    source: 'CUSTOM',
    side: 'BUY',
    targetPrice: input.targetPrice,
    comparator: 'LTE',
    orderType: input.orderType,
    qtyOrAmountMode: input.qtyOrAmountMode,
    ...(input.qtyOrAmountMode === 'QTY' ? { qty: input.qty as number } : {}),
    ...(input.qtyOrAmountMode === 'AMOUNT' ? { amountKrw: input.amountKrw as number } : {}),
    sourceRefId: owned.sourceRefId ?? undefined,
    metadata: owned.metadata ?? undefined,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `수정 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.updated',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

export function listWatchHistory(ctx: Context, input: WatchHistoryInput | undefined) {
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const rows = ctx.db
    .select()
    .from(eventLogs)
    .where(eq(eventLogs.category, 'WATCH'))
    .orderBy(desc(eventLogs.id))
    .limit(input?.limit ?? 200)
    .all();
  const items = rows
    .map((row): WatchHistoryItem | null => {
      let payload: Record<string, unknown> = {};
      try {
        payload = row.payloadJson ? (JSON.parse(row.payloadJson) as Record<string, unknown>) : {};
      } catch {
        payload = {};
      }
      const accountId =
        typeof payload.accountId === 'number' && Number.isInteger(payload.accountId)
          ? payload.accountId
          : null;
      if (accountId !== activeAccountId) return null;
      return {
        id: row.id,
        at: row.ts,
        level: row.level as 'INFO' | 'WARN' | 'ERROR',
        message: row.message,
        accountId,
        pdno: typeof payload.pdno === 'string' ? payload.pdno : null,
        source: payload.source === 'PREBUY' || payload.source === 'CUSTOM' ? payload.source : null,
        watchId:
          typeof payload.watchId === 'number' && Number.isInteger(payload.watchId)
            ? payload.watchId
            : null,
        reason: typeof payload.reason === 'string' ? payload.reason : null,
      };
    })
    .filter((item): item is WatchHistoryItem => item !== null);
  return { items };
}

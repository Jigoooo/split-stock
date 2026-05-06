import { BROKERS } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { watchOrders } from '../../db/schema';
import type { EventLogger } from '../../logging/event-logger';
import type { Context } from '../context';

const STOCK_BROKER = BROKERS.KIS;

export type WatchStatus = 'WATCHING' | 'PAUSED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type WatchSource = 'BOOSTER' | 'PREBUY' | 'CUSTOM';

export interface WatchListInput {
  status?: WatchStatus | undefined;
  source?: WatchSource | undefined;
  accountId?: number | undefined;
  /**
   * Phase R3-2: client 가 broker 를 통과시킬 수 있도록 schema 에 받아 둔다.
   * 서버 핸들러(listWatchOrders / watchEngine.list)는 R3-3 까지 STOCK_BROKER('KIS') 하드코딩.
   */
  broker?: string | undefined;
}

export interface AccountScopedInput {
  accountId?: number | undefined;
}

export interface SetGlobalEnabledInput extends AccountScopedInput {
  enabled: boolean;
}

export interface IdInput {
  id: number;
}

export interface ReservationBuyCreateInput {
  accountId: number;
  pdno: string;
  targetPrice: number;
  orderType: 'MARKET' | 'LIMIT';
  qtyOrAmountMode: 'QTY' | 'AMOUNT';
  qty?: number | undefined;
  amountKrw?: number | undefined;
  expiresAt?: number | Date | undefined;
}

export interface ReservationBuyUpdateInput extends Omit<ReservationBuyCreateInput, 'accountId'> {
  id: number;
}

export interface WatchHistoryInput {
  limit?: number | undefined;
  /** Phase R3-2: client 가 broker 통과 — 서버측은 R3-3 까지 무시. */
  broker?: string | undefined;
}

export interface WatchHistoryItem {
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

export function ensureWatchEngine(ctx: Context): NonNullable<Context['watchEngine']> {
  if (!ctx.watchEngine) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'watchEngine이 초기화되지 않음',
    });
  }
  return ctx.watchEngine;
}

export function ensureActiveAccountId(activeAccountId: number | null): number {
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다. 자격증명을 먼저 등록하세요.',
    });
  }
  return activeAccountId;
}

export function ensureRequestedAccount(
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

export function logWatchEvent(
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

export function getOwnedWatchOrder(ctx: Context, id: number, activeAccountId: number) {
  const owned = ctx.db
    .select()
    .from(watchOrders)
    .where(
      and(
        eq(watchOrders.broker, STOCK_BROKER),
        eq(watchOrders.id, id),
        eq(watchOrders.accountId, activeAccountId),
      ),
    )
    .get();
  if (!owned) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: '해당 자동감시주문을 찾을 수 없습니다.',
    });
  }
  return owned;
}

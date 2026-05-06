import { BROKERS } from '@shared/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { getDomesticBrokerForAccount } from '../db/account-broker';
import type { Db } from '../db/client';
import { watchOrders } from '../db/schema';
import {
  ACTIVE_CONTROL_STATUSES,
  rowToOrder,
  type WatchError,
  type WatchOrder,
  type WatchOrderInput,
  WatchOrderInputSchema,
  type WatchSource,
  type WatchStatus,
} from './watch-engine-types';

/** Phase 6: WatchEngine 은 도메스틱 broker(KIS+KIWOOM) 모두 처리. UPBIT 는 cryptoAutoWatches 별도. */
const DOMESTIC_BROKERS_FILTER = [BROKERS.KIS, BROKERS.KIWOOM] as const;

export function loadWatchingOrders(db: Db): WatchOrder[] {
  return db
    .select()
    .from(watchOrders)
    .where(
      and(
        inArray(watchOrders.broker, [...DOMESTIC_BROKERS_FILTER]),
        eq(watchOrders.status, 'WATCHING'),
      ),
    )
    .all()
    .map(rowToOrder);
}

export function upsertWatchOrder(db: Db, input: WatchOrderInput): Result<WatchOrder, WatchError> {
  const parsed = WatchOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({ kind: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid' });
  }
  const v = parsed.data;
  // Phase 6 H1 fix: 명시적 broker resolution. 미존재/non-domestic 계좌면 VALIDATION 에러
  // (silent KIS fallback 금지 — KIWOOM 의도였던 row 가 KIS 로 misclassify 되는 race 방지).
  const broker = getDomesticBrokerForAccount(db, v.accountId);
  if (!broker) {
    return err({
      kind: 'VALIDATION',
      message: `account ${v.accountId} 가 존재하지 않거나 도메스틱 broker (KIS/KIWOOM) 가 아닙니다`,
    });
  }
  const now = new Date();
  const expiresAt =
    v.expiresAt === undefined
      ? null
      : v.expiresAt instanceof Date
        ? v.expiresAt
        : new Date(v.expiresAt);

  try {
    const existing =
      v.sourceRefId === undefined
        ? null
        : db
            .select()
            .from(watchOrders)
            .where(
              and(
                eq(watchOrders.broker, broker),
                eq(watchOrders.accountId, v.accountId),
                eq(watchOrders.source, v.source),
                eq(watchOrders.sourceRefId, v.sourceRefId),
                inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES),
              ),
            )
            .get();

    if (existing) {
      const row = db
        .update(watchOrders)
        .set({
          pdno: v.pdno,
          side: v.side,
          targetPrice: v.targetPrice,
          comparator: v.comparator,
          orderType: v.orderType,
          qtyOrAmountMode: v.qtyOrAmountMode,
          qty: v.qty ?? null,
          amountKrw: v.amountKrw ?? null,
          nth: v.nth ?? null,
          expiresAt,
          lastFailureReason: null,
          metadata: v.metadata ?? existing.metadata ?? null,
          updatedAt: now,
        })
        .where(eq(watchOrders.id, existing.id))
        .returning()
        .all()[0];
      if (!row) return err({ kind: 'DB_ERROR', cause: 'update returned no row' });
      return ok(rowToOrder(row));
    }

    const row = db
      .insert(watchOrders)
      .values({
        broker,
        accountId: v.accountId,
        pdno: v.pdno,
        source: v.source,
        side: v.side,
        targetPrice: v.targetPrice,
        comparator: v.comparator,
        orderType: v.orderType,
        qtyOrAmountMode: v.qtyOrAmountMode,
        qty: v.qty ?? null,
        amountKrw: v.amountKrw ?? null,
        nth: v.nth ?? null,
        sourceRefId: v.sourceRefId ?? null,
        expiresAt,
        status: 'WATCHING',
        lastFailureReason: null,
        metadata: v.metadata ?? null,
        createdAt: now,
        updatedAt: now,
        executedAt: null,
      })
      .returning()
      .all()[0];
    if (!row) return err({ kind: 'DB_ERROR', cause: 'insert returned no row' });
    return ok(rowToOrder(row));
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function cancelWatchOrder(db: Db, id: number): Result<void, WatchError> {
  try {
    const now = new Date();
    const res = db
      .update(watchOrders)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(and(eq(watchOrders.id, id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)))
      .run();
    if (res.changes === 0) return err({ kind: 'NOT_FOUND', id });
    return ok(undefined);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function pauseWatchOrder(db: Db, id: number): Result<void, WatchError> {
  try {
    const res = db
      .update(watchOrders)
      .set({ status: 'PAUSED', updatedAt: new Date() })
      .where(and(eq(watchOrders.id, id), eq(watchOrders.status, 'WATCHING')))
      .run();
    if (res.changes === 0) return err({ kind: 'NOT_FOUND', id });
    return ok(undefined);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function updateWatchOrder(
  db: Db,
  id: number,
  input: WatchOrderInput,
): Result<WatchOrder, WatchError> {
  const parsed = WatchOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({ kind: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid' });
  }
  const v = parsed.data;
  const expiresAt =
    v.expiresAt === undefined
      ? null
      : v.expiresAt instanceof Date
        ? v.expiresAt
        : new Date(v.expiresAt);
  try {
    const row = db
      .update(watchOrders)
      .set({
        pdno: v.pdno,
        source: v.source,
        side: v.side,
        targetPrice: v.targetPrice,
        comparator: v.comparator,
        orderType: v.orderType,
        qtyOrAmountMode: v.qtyOrAmountMode,
        qty: v.qty ?? null,
        amountKrw: v.amountKrw ?? null,
        nth: v.nth ?? null,
        sourceRefId: v.sourceRefId ?? null,
        expiresAt,
        metadata: v.metadata ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(watchOrders.id, id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)))
      .returning()
      .all()[0];
    if (!row) return err({ kind: 'NOT_FOUND', id });
    return ok(rowToOrder(row));
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function resumeWatchOrder(db: Db, id: number): Result<WatchOrder, WatchError> {
  try {
    const row = db
      .update(watchOrders)
      .set({ status: 'WATCHING', updatedAt: new Date() })
      .where(and(eq(watchOrders.id, id), eq(watchOrders.status, 'PAUSED')))
      .returning()
      .all()[0];
    if (!row) return err({ kind: 'NOT_FOUND', id });
    return ok(rowToOrder(row));
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function listWatchOrders(
  db: Db,
  filter: {
    status?: WatchStatus | undefined;
    source?: WatchSource | undefined;
    accountId?: number | undefined;
  } = {},
): WatchOrder[] {
  const clauses = [inArray(watchOrders.broker, [...DOMESTIC_BROKERS_FILTER])];
  if (filter.status) clauses.push(eq(watchOrders.status, filter.status));
  if (filter.source) clauses.push(eq(watchOrders.source, filter.source));
  if (filter.accountId) clauses.push(eq(watchOrders.accountId, filter.accountId));
  const rows = db
    .select()
    .from(watchOrders)
    .where(and(...clauses))
    .all();
  return rows.map(rowToOrder);
}

export function expireStaleWatchOrders(
  db: Db,
  now: number,
): Array<{ id: number; expiredOrder: WatchOrder | null }> {
  const rows = db
    .select()
    .from(watchOrders)
    .where(
      and(
        inArray(watchOrders.broker, [...DOMESTIC_BROKERS_FILTER]),
        inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES),
      ),
    )
    .all()
    .filter((row) => row.expiresAt !== null && row.expiresAt.getTime() <= now);

  return rows.map((row) => {
    const res = db
      .update(watchOrders)
      .set({ status: 'EXPIRED', updatedAt: new Date(now) })
      .where(and(eq(watchOrders.id, row.id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)))
      .run();
    if (res.changes === 0) return { id: row.id, expiredOrder: null };
    const next = db.select().from(watchOrders).where(eq(watchOrders.id, row.id)).get();
    return { id: row.id, expiredOrder: next ? rowToOrder(next) : null };
  });
}

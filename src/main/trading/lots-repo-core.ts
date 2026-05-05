import { and, eq, ne } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lots as lotsTable } from '../db/schema';
import type { LotStatus, PositionSnapshot } from './fsm';
import type { LotsRepoError } from './lots-repo-errors';
import type { InsertLotInput, UpdateLotStatusInput } from './lots-repo-types';
import type { RespiitPlan } from './respiit-planner';

export function snapshot(
  db: Db,
  accountId: number,
  pdno: string,
  broker: string = 'KIS',
): Result<PositionSnapshot, LotsRepoError> {
  try {
    const rows = db
      .select()
      .from(lotsTable)
      .where(
        and(
          eq(lotsTable.broker, broker),
          eq(lotsTable.accountId, accountId),
          eq(lotsTable.pdno, pdno),
        ),
      )
      .all();
    return ok({
      pdno,
      lots: rows.map((r) => ({
        nth: r.nth,
        buyPrice: r.buyPrice,
        qty: r.qty,
        status: r.status as LotStatus,
      })),
    });
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

/**
 * 원자적 insert — 이미 존재하는 (accountId, pdno, nth) 차수는 거부.
 * 동시성 안전: transaction으로 select-then-insert 사이 경합 차단.
 */
export function insertLot(
  db: Db,
  input: InsertLotInput,
  broker: string = 'KIS',
): Result<number, LotsRepoError> {
  try {
    const id = db.transaction((tx) => {
      const existing = tx
        .select({ id: lotsTable.id })
        .from(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.accountId, input.accountId),
            eq(lotsTable.pdno, input.pdno),
            eq(lotsTable.nth, input.nth),
          ),
        )
        .all();
      if (existing.length > 0) {
        throw new Error(
          `duplicate lot: account=${input.accountId} pdno=${input.pdno} nth=${input.nth}`,
        );
      }
      const inserted = tx
        .insert(lotsTable)
        .values({
          broker,
          accountId: input.accountId,
          pdno: input.pdno,
          nth: input.nth,
          buyPrice: input.buyPrice,
          qty: input.qty,
          amountKrw: input.amountKrw,
          status: input.status,
          boughtAt: input.boughtAt,
        })
        .returning({ id: lotsTable.id })
        .all();
      const row = inserted[0];
      if (!row) throw new Error('insert returned no row');
      return row.id;
    });
    return ok(id);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

/**
 * 리스플리트(재편성) — 기존 OPEN 차수를 삭제하고 새 plan으로 교체.
 * SOLD/BUYING/SELLING 상태 차수는 보존 (확정된 과거 기록).
 * 전체 트랜잭션 — 중간 실패 시 완전 rollback.
 */
export function replan(
  db: Db,
  accountId: number,
  plan: RespiitPlan,
  broker: string = 'KIS',
): Result<{ insertedIds: number[] }, LotsRepoError> {
  try {
    const insertedIds = db.transaction((tx) => {
      // OPEN 차수만 제거. SOLD/BUYING/SELLING은 감사 기록으로 보존.
      tx.delete(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.accountId, accountId),
            eq(lotsTable.pdno, plan.pdno),
            eq(lotsTable.status, 'OPEN'),
          ),
        )
        .run();
      // 보존된 차수와 nth가 겹치는지 검증 — 겹치면 full rollback
      const preserved = tx
        .select({ nth: lotsTable.nth })
        .from(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.accountId, accountId),
            eq(lotsTable.pdno, plan.pdno),
            ne(lotsTable.status, 'OPEN'),
          ),
        )
        .all();
      const preservedNths = new Set(preserved.map((r) => r.nth));
      for (const e of plan.entries) {
        if (preservedNths.has(e.nth)) {
          throw new Error(
            `replan nth 충돌: account=${accountId} pdno=${plan.pdno} nth=${e.nth}은 보존된 차수와 겹칩니다`,
          );
        }
      }
      const ids: number[] = [];
      for (const e of plan.entries) {
        const inserted = tx
          .insert(lotsTable)
          .values({
            broker,
            accountId,
            pdno: plan.pdno,
            nth: e.nth,
            buyPrice: e.buyPrice,
            qty: e.qty,
            amountKrw: e.amountKrw,
            status: 'OPEN' as LotStatus,
            boughtAt: e.boughtAt,
          })
          .returning({ id: lotsTable.id })
          .all();
        const row = inserted[0];
        if (!row) throw new Error('replan insert returned no row');
        ids.push(row.id);
      }
      return ids;
    });
    return ok({ insertedIds });
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

export function updateLotStatus(db: Db, input: UpdateLotStatusInput): Result<void, LotsRepoError> {
  try {
    db.transaction((tx) => {
      const updates: Partial<typeof lotsTable.$inferInsert> = { status: input.status };
      if (input.sellPrice !== undefined) updates.sellPrice = input.sellPrice;
      if (input.soldAt !== undefined) updates.soldAt = input.soldAt;
      const res = tx.update(lotsTable).set(updates).where(eq(lotsTable.id, input.lotId)).run();
      if (res.changes === 0) {
        throw new Error(`lot not found: id=${input.lotId}`);
      }
    });
    return ok(undefined);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lots as lotsTable } from '../db/schema';
import type { LotStatus, PositionSnapshot } from './fsm';

export type LotsRepoError = { kind: 'DB_ERROR'; cause: unknown };

export interface InsertLotInput {
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: Date;
}

export interface UpdateLotStatusInput {
  lotId: number;
  status: LotStatus;
  sellPrice?: number;
  soldAt?: Date;
}

/**
 * 차수 장부 레포지토리.
 * 중요: better-sqlite3 transaction으로 insert/update가 원자적으로 실행됨.
 * 콜백이 throw하면 자동 rollback.
 */
export class LotsRepo {
  constructor(private readonly db: Db) {}

  snapshot(accountId: number, pdno: string): Result<PositionSnapshot, LotsRepoError> {
    try {
      const rows = this.db
        .select()
        .from(lotsTable)
        .where(and(eq(lotsTable.accountId, accountId), eq(lotsTable.pdno, pdno)))
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
  insertLot(input: InsertLotInput): Result<number, LotsRepoError> {
    try {
      const id = this.db.transaction((tx) => {
        const existing = tx
          .select({ id: lotsTable.id })
          .from(lotsTable)
          .where(
            and(
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

  updateLotStatus(input: UpdateLotStatusInput): Result<void, LotsRepoError> {
    try {
      this.db.transaction((tx) => {
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
}

import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { prebuyOrders } from '../db/schema';

export type PrebuyStatus = 'PENDING' | 'FILLED' | 'EXPIRED' | 'CANCELLED';

export interface PrebuyOrder {
  id: number;
  accountId: number | null;
  pdno: string;
  targetPrice: number;
  amountKrw: number;
  validUntil: Date;
  status: PrebuyStatus;
  createdAt: Date;
}

export type PrebuyError =
  | { kind: 'CAP_EXCEEDED'; max: number }
  | { kind: 'DUPLICATE_PENDING'; pdno: string }
  | { kind: 'NOT_FOUND'; id: number }
  | { kind: 'DB_ERROR'; cause: unknown };

const PENDING_CAP = 100;

export class PrebuyRepo {
  constructor(private readonly db: Db) {}

  insert(input: {
    accountId: number;
    pdno: string;
    targetPrice: number;
    amountKrw: number;
    validUntil: Date;
  }): Result<number, PrebuyError> {
    try {
      const id = this.db.transaction((tx) => {
        const pending = tx
          .select({ id: prebuyOrders.id })
          .from(prebuyOrders)
          .where(eq(prebuyOrders.status, 'PENDING'))
          .all();
        if (pending.length >= PENDING_CAP) {
          throw { kind: 'CAP_EXCEEDED' as const, max: PENDING_CAP };
        }
        const dup = tx
          .select({ id: prebuyOrders.id })
          .from(prebuyOrders)
          .where(
            and(
              eq(prebuyOrders.accountId, input.accountId),
              eq(prebuyOrders.pdno, input.pdno),
              eq(prebuyOrders.status, 'PENDING'),
            ),
          )
          .all();
        if (dup.length > 0) {
          throw { kind: 'DUPLICATE_PENDING' as const, pdno: input.pdno };
        }
        const inserted = tx
          .insert(prebuyOrders)
          .values({
            accountId: input.accountId,
            pdno: input.pdno,
            targetPrice: input.targetPrice,
            amountKrw: input.amountKrw,
            validUntil: input.validUntil,
            status: 'PENDING',
            createdAt: new Date(),
          })
          .returning({ id: prebuyOrders.id })
          .all();
        const row = inserted[0];
        if (!row) throw { kind: 'DB_ERROR' as const, cause: 'insert returned no row' };
        return row.id;
      });
      return ok(id);
    } catch (e) {
      if (e && typeof e === 'object' && 'kind' in e) {
        return err(e as PrebuyError);
      }
      return err({ kind: 'DB_ERROR', cause: e });
    }
  }

  listPending(): PrebuyOrder[] {
    const rows = this.db
      .select()
      .from(prebuyOrders)
      .where(eq(prebuyOrders.status, 'PENDING'))
      .all();
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId ?? null,
      pdno: r.pdno,
      targetPrice: r.targetPrice,
      amountKrw: r.amountKrw,
      validUntil: r.validUntil,
      status: r.status as PrebuyStatus,
      createdAt: r.createdAt,
    }));
  }

  getById(id: number): PrebuyOrder | null {
    const row = this.db.select().from(prebuyOrders).where(eq(prebuyOrders.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.accountId ?? null,
      pdno: row.pdno,
      targetPrice: row.targetPrice,
      amountKrw: row.amountKrw,
      validUntil: row.validUntil,
      status: row.status as PrebuyStatus,
      createdAt: row.createdAt,
    };
  }

  cancel(id: number): Result<void, PrebuyError> {
    return this.updateStatus(id, 'CANCELLED');
  }

  markFilled(id: number): Result<void, PrebuyError> {
    return this.updateStatus(id, 'FILLED');
  }

  markExpired(id: number): Result<void, PrebuyError> {
    return this.updateStatus(id, 'EXPIRED');
  }

  private updateStatus(id: number, status: PrebuyStatus): Result<void, PrebuyError> {
    try {
      const res = this.db.update(prebuyOrders).set({ status }).where(eq(prebuyOrders.id, id)).run();
      if (res.changes === 0) return err({ kind: 'NOT_FOUND', id });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }
}

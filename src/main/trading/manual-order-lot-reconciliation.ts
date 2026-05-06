import { BROKERS } from '@shared/contracts';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots } from '../db/schema';
import type { ReconcileDecision } from './manual-order-reconciliation-policy';
import { reconcileCancelledSellLot } from './partial-sell-lot-reconciliation';

const STOCK_BROKER = BROKERS.KIS;

export function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function weightedAvgTradePrice(rows: Array<{ qty: number; price: number }>): number {
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  if (totalQty <= 0) return 0;
  const totalAmount = rows.reduce((sum, row) => sum + row.qty * row.price, 0);
  return Math.round(totalAmount / totalQty);
}

export function readLotNth(db: Db, lotId: number): number | null {
  const row = db
    .select({ nth: lots.nth })
    .from(lots)
    .where(and(eq(lots.id, lotId), eq(lots.broker, STOCK_BROKER)))
    .get();
  return row?.nth ?? null;
}

export function reconcileLinkedLot(
  db: Db,
  input: {
    decision: ReconcileDecision;
    lotId: number;
    now: Date;
    side: 'BUY' | 'SELL';
  },
): void {
  if (input.side === 'BUY') {
    if (input.decision.nextStatus === 'CANCELLED' && input.decision.totalFilledQty === 0) {
      db.delete(lots)
        .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
        .run();
      return;
    }

    db.update(lots)
      .set({
        buyPrice: input.decision.executionPrice,
        qty: input.decision.totalFilledQty,
        amountKrw: input.decision.executionPrice * input.decision.totalFilledQty,
        status: input.decision.nextStatus === 'PARTIAL' ? 'BUYING' : 'OPEN',
      })
      .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
      .run();
    return;
  }

  if (input.decision.nextStatus === 'FILLED') {
    db.update(lots)
      .set({
        status: 'SOLD',
        soldAt: input.now,
        sellPrice: input.decision.executionPrice,
      })
      .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
      .run();
    return;
  }

  if (input.decision.nextStatus === 'CANCELLED') {
    reconcileCancelledSellLot(db, {
      lotId: input.lotId,
      filledQty: input.decision.totalFilledQty,
      executionPrice: input.decision.executionPrice,
      now: input.now,
    });
  }
}

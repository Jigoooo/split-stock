import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots } from '../db/schema';

const STOCK_BROKER = 'KIS';

export function reconcileCancelledSellLot(
  db: Db,
  input: {
    lotId: number;
    filledQty: number;
    executionPrice: number;
    now: Date;
  },
): void {
  const current = db
    .select({
      buyPrice: lots.buyPrice,
      qty: lots.qty,
    })
    .from(lots)
    .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
    .get();
  if (!current) return;

  const filledQty = Math.max(0, input.filledQty);
  if (filledQty <= 0) {
    db.update(lots)
      .set({
        status: 'OPEN',
        soldAt: null,
        sellPrice: null,
      })
      .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
      .run();
    return;
  }

  const remainingQty = Math.max(0, current.qty - filledQty);
  if (remainingQty <= 0) {
    db.update(lots)
      .set({
        status: 'SOLD',
        soldAt: input.now,
        sellPrice: input.executionPrice,
      })
      .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
      .run();
    return;
  }

  db.update(lots)
    .set({
      status: 'OPEN',
      qty: remainingQty,
      amountKrw: current.buyPrice * remainingQty,
      soldAt: null,
      sellPrice: null,
    })
    .where(and(eq(lots.id, input.lotId), eq(lots.broker, STOCK_BROKER)))
    .run();
}

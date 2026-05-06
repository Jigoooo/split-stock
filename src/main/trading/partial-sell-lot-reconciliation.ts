import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots } from '../db/schema';

// Phase 6: lots.id 는 PK — broker 필터 불필요. 도메스틱(KIS/KIWOOM) 모두 처리.

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
    .where(eq(lots.id, input.lotId))
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
      .where(eq(lots.id, input.lotId))
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
      .where(eq(lots.id, input.lotId))
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
    .where(eq(lots.id, input.lotId))
    .run();
}

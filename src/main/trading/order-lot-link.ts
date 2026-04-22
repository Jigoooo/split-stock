import { deriveNextBuyNth } from '@shared/trading/next-nth';
import type { EventLogger } from '../logging/event-logger';
import type { LotsRepo } from './lots-repo';

export interface OrderLotLinkDeps {
  logger: EventLogger;
  lotsRepo: LotsRepo;
}

export function createPendingBuyLot(
  deps: OrderLotLinkDeps,
  input: {
    accountId: number;
    pdno: string;
    placedAt: Date;
    price: number;
    qty: number;
    requestedNth?: number | null;
    source: 'MANUAL' | 'PREBUY' | 'BOOSTER' | 'CUSTOM';
  },
): {
  lotId: number | null;
  nth: number;
} {
  const snapshot = deps.lotsRepo.snapshot(input.accountId, input.pdno);
  if (snapshot.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'ORDER',
      message: 'order.buying-lot.snapshot-failed',
      payload: { accountId: input.accountId, pdno: input.pdno, source: input.source },
    });
    return { lotId: null, nth: input.source === 'BOOSTER' ? (input.requestedNth ?? 1) : 1 };
  }

  const nth =
    input.source === 'BOOSTER' ? (input.requestedNth ?? 1) : deriveNextBuyNth(snapshot.value.lots);
  const inserted = deps.lotsRepo.insertLot({
    accountId: input.accountId,
    pdno: input.pdno,
    nth,
    buyPrice: input.price,
    qty: input.qty,
    amountKrw: input.price * input.qty,
    status: 'BUYING',
    boughtAt: input.placedAt,
  });
  if (inserted.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'ORDER',
      message: 'order.buying-lot.insert-failed',
      payload: { accountId: input.accountId, nth, pdno: input.pdno, source: input.source },
    });
    return { lotId: null, nth };
  }
  return { lotId: inserted.value, nth };
}

export function linkPendingSellLot(
  deps: OrderLotLinkDeps,
  input: {
    accountId: number;
    pdno: string;
    requestedNth?: number | null;
  },
): {
  lotId: number | null;
  nth: number | null;
} {
  if (input.requestedNth === null || input.requestedNth === undefined) {
    return { lotId: null, nth: null };
  }
  const rows = deps.lotsRepo.listRows(input.accountId, input.pdno);
  if (rows.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'ORDER',
      message: 'order.selling-lot.lookup-failed',
      payload: { accountId: input.accountId, nth: input.requestedNth, pdno: input.pdno },
    });
    return { lotId: null, nth: input.requestedNth };
  }

  const target = rows.value.find((lot) => lot.nth === input.requestedNth && lot.status === 'OPEN');
  if (!target) {
    return { lotId: null, nth: input.requestedNth };
  }

  const updated = deps.lotsRepo.updateLotStatus({ lotId: target.id, status: 'SELLING' });
  if (updated.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'ORDER',
      message: 'order.selling-lot.mark-failed',
      payload: { accountId: input.accountId, lotId: target.id, pdno: input.pdno },
    });
    return { lotId: null, nth: input.requestedNth };
  }

  return { lotId: target.id, nth: target.nth };
}

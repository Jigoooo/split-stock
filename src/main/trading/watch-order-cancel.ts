import { makeBrokerError, type OrderAck } from '@shared/contracts';
import { and, eq } from 'drizzle-orm';
import { err } from 'neverthrow';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import { lots, orders } from '../db/schema';
import type { PendingOrderWatcher } from './pending-order-watcher';
import type { WatchOrderExecutorDeps } from './watch-order-types';

export async function cancelAcceptedBrokerOrderAfterLocalFailure(
  deps: WatchOrderExecutorDeps,
  broker: BrokerPort,
  ack: OrderAck,
  input: {
    division: 'LIMIT' | 'MARKET';
    pdno: string;
  },
): Promise<void> {
  if (!ack.brokerOrgNo && broker.brokerId === 'KIS') {
    deps.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-failure.cancel-skipped-orgno-missing',
      payload: { odno: ack.brokerOrderId, pdno: input.pdno },
    });
    return;
  }
  const cancelResult = await broker
    .cancelOrder({
      brokerOrderId: ack.brokerOrderId,
      ...(ack.brokerOrgNo !== undefined && { brokerOrgNo: ack.brokerOrgNo }),
      qtyAllOrder: true,
      all: true,
      kind: input.division,
      symbol: input.pdno,
    })
    .catch((cause) =>
      err(
        makeBrokerError({
          brokerId: broker.brokerId,
          kind: 'UNKNOWN',
          msg: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
      ),
    );
  if (cancelResult.isErr()) {
    deps.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-failure.cancel-failed',
      payload: {
        kind: cancelResult.error.kind,
        msg: cancelResult.error.msg,
        odno: ack.brokerOrderId,
        pdno: input.pdno,
      },
    });
  }
}

export function cancelPendingByOdno(
  db: Db,
  pendingOrderWatcher: PendingOrderWatcher | null,
  accountId: number,
  odno: string,
): void {
  // Phase 6: orders.odno + accountId 조합으로 도메스틱 broker 모두 lookup. row.broker 로 downstream dispatch.
  const row = db
    .select()
    .from(orders)
    .where(and(eq(orders.odno, odno), eq(orders.accountId, accountId)))
    .get();
  if (!row) return;
  db.update(orders)
    .set({ status: 'CANCELLED' })
    .where(
      and(eq(orders.broker, row.broker), eq(orders.odno, odno), eq(orders.accountId, accountId)),
    )
    .run();
  if (row.lotId !== null && row.lotId !== undefined) {
    if (row.side === 'BUY') {
      db.delete(lots)
        .where(and(eq(lots.id, row.lotId), eq(lots.broker, row.broker)))
        .run();
    } else if (row.side === 'SELL') {
      db.update(lots)
        .set({ status: 'OPEN', soldAt: null, sellPrice: null })
        .where(and(eq(lots.id, row.lotId), eq(lots.broker, row.broker)))
        .run();
    }
  }
  if (!pendingOrderWatcher) return;
  const active = pendingOrderWatcher.listActive();
  for (const entry of active) {
    if (entry.odno !== odno) continue;
    pendingOrderWatcher.cancel({
      pdno: entry.pdno,
      side: entry.side,
      nth: entry.nth,
    });
  }
}

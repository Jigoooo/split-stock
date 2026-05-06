import type { OrderAck } from '@shared/contracts';
import { orders } from '../db/schema';
import { readPendingCancelConfig } from '../db/settings-repo';
import type { WatchOrder } from './watch-engine';
import type {
  PreparedOrderLot,
  StrategyOrderInput,
  WatchOrderExecutorDeps,
} from './watch-order-types';

export function seedFirstEntryStrategyIfNeeded(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
): void {
  if ((order.source !== 'PREBUY' && order.source !== 'CUSTOM') || order.side !== 'BUY') return;

  const seeded = deps.strategyRepo.ensureSeededActive(order.accountId, order.pdno);
  if (seeded.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'WATCH',
      message: 'watch.first-entry.seed-failed',
      payload: {
        accountId: order.accountId,
        pdno: order.pdno,
        source: order.source,
        reason: seeded.error.kind,
      },
    });
    return;
  }
  deps.logger.log({
    level: 'INFO',
    category: 'WATCH',
    message: 'watch.first-entry.seeded',
    payload: {
      accountId: order.accountId,
      pdno: order.pdno,
      source: order.source,
      templateSource: seeded.value.source,
    },
  });
}

export function recordStrategyOrder(
  deps: WatchOrderExecutorDeps,
  input: StrategyOrderInput,
  ack: OrderAck,
  now: Date,
  linkedLot: PreparedOrderLot,
  opts: { reconciled: boolean; broker: string },
): void {
  deps.db
    .insert(orders)
    .values({
      broker: opts.broker,
      accountId: input.accountId,
      lotId: linkedLot.lotId,
      odno: ack.brokerOrderId,
      orgNo: ack.brokerOrgNo ?? null,
      pdno: input.pdno,
      side: input.side,
      division: input.division,
      qty: input.qty,
      price: input.division === 'LIMIT' ? input.price : 0,
      status: 'PENDING',
      placedAt: now,
    })
    .run();

  const pendingCfg = readPendingCancelConfig(deps.settingsRepo);
  if (
    pendingCfg.enabled &&
    input.division === 'LIMIT' &&
    ack.brokerOrgNo &&
    deps.pendingOrderWatcher
  ) {
    deps.pendingOrderWatcher.register({
      pdno: input.pdno,
      side: input.side,
      nth: linkedLot.nth ?? input.nth,
      odno: ack.brokerOrderId,
      orgNo: ack.brokerOrgNo,
      qty: input.qty,
      accountId: input.accountId,
    });
  }

  deps.logger.log({
    level: 'INFO',
    category: 'FSM',
    message: 'strategy.order-submitted',
    payload: {
      accountId: input.accountId,
      pdno: input.pdno,
      side: input.side,
      nth: linkedLot.nth ?? input.nth,
      triggerReason: input.triggerReason,
      qty: input.qty,
      price: input.price,
      reconciled: opts.reconciled,
    },
  });
}

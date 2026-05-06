import type { OrderAck } from '@shared/contracts';
import { BROKERS } from '@shared/contracts';
import { eq } from 'drizzle-orm';
import { accounts, orders } from '../db/schema';
import { readPendingCancelConfig } from '../db/settings-repo';
import type { WatchOrder } from './watch-engine';
import type {
  PreparedOrderLot,
  StrategyOrderInput,
  WatchOrderExecutorDeps,
} from './watch-order-types';

/** Phase 6: 자동매매 orders insert 시 accountId 의 도메스틱 broker(KIS/KIWOOM) 를 read. */
function resolveDomesticBrokerForAccount(deps: WatchOrderExecutorDeps, accountId: number): string {
  const row = deps.db
    .select({ broker: accounts.broker })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  return row?.broker === BROKERS.KIWOOM ? BROKERS.KIWOOM : BROKERS.KIS;
}

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
  opts: { reconciled: boolean },
): void {
  deps.db
    .insert(orders)
    .values({
      broker: resolveDomesticBrokerForAccount(deps, input.accountId),
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

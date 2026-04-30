import type { ActiveAccountRepo } from '../account/active-account';
import { realTimer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import type { PrebuyRepo } from '../trading/prebuy-repo';
import { PrebuyWatcher } from '../trading/prebuy-watcher';
import type { WatchEngine, WatchOrder } from '../trading/watch-engine';

export function resolvePrebuySource(prebuyRepo: PrebuyRepo, order: WatchOrder) {
  const prebuyId = Number(order.sourceRefId);
  if (!Number.isInteger(prebuyId) || prebuyId <= 0) {
    return { ok: false as const, result: { ok: false, reason: 'PREBUY_SOURCE_REF_INVALID' } };
  }
  const source = prebuyRepo.getById(prebuyId);
  if (!source)
    return { ok: false as const, result: { ok: false, reason: 'PREBUY_SOURCE_NOT_FOUND' } };
  if (source.accountId !== null && source.accountId !== order.accountId) {
    return { ok: false as const, result: { ok: false, reason: 'PREBUY_ACCOUNT_MISMATCH' } };
  }
  if (source.status !== 'PENDING') {
    return { ok: false as const, result: { ok: false, reason: `PREBUY_STATUS_${source.status}` } };
  }
  return { ok: true as const, prebuyId: source.id, source };
}

export function createPrebuyWatchers(
  input: {
    activeAccounts: ActiveAccountRepo;
    logger: EventLogger;
    prebuyRepo: PrebuyRepo;
  },
  watchEngine: WatchEngine,
  runWatchedOrder: (order: WatchOrder, triggerPrice: number) => Promise<void>,
): Map<number, PrebuyWatcher> {
  const prebuyWatchers = new Map<number, PrebuyWatcher>();
  for (const account of input.activeAccounts.list()) {
    const prebuyWatcher = new PrebuyWatcher({
      timer: realTimer,
      repo: input.prebuyRepo,
      engine: watchEngine,
      accountId: account.id,
      onTrigger: (source, ctx) =>
        runWatchedOrder(
          {
            id: 0,
            accountId: account.id,
            pdno: source.pdno,
            source: 'PREBUY',
            side: 'BUY',
            targetPrice: source.targetPrice,
            comparator: 'LTE',
            orderType: 'LIMIT',
            qtyOrAmountMode: 'AMOUNT',
            qty: null,
            amountKrw: source.amountKrw,
            nth: null,
            sourceRefId: String(source.id),
            expiresAt: source.validUntil,
            status: 'WATCHING',
            lastFailureReason: null,
            metadata: null,
            createdAt: source.createdAt,
            updatedAt: source.createdAt,
            executedAt: null,
          },
          ctx.price,
        ),
      onExpire: (source) => {
        input.logger.log({
          level: 'INFO',
          category: 'WATCH',
          message: 'watch.prebuy.expired',
          payload: { accountId: source.accountId, prebuyId: source.id, pdno: source.pdno },
        });
      },
    });
    prebuyWatcher.reload();
    prebuyWatchers.set(account.id, prebuyWatcher);
  }
  return prebuyWatchers;
}

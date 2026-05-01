import type {
  CryptoExchangeError,
  CryptoExchangeId,
  CryptoOrderSnapshot,
  CryptoReconcileResult,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import type { CryptoTradingRepo } from './crypto-repo';
import type { CryptoMarketDataAdapter } from './ports';

const ORDER_STREAM = 'orders';
const CLOSED_ORDER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export class CryptoOrderReconciler {
  constructor(
    private readonly repo: CryptoTradingRepo,
    private readonly logger: EventLogger,
    private readonly now: () => number = Date.now,
  ) {}

  async reconcile(input: {
    accountId: number;
    exchange: CryptoExchangeId;
    adapter: CryptoMarketDataAdapter;
    reason: CryptoReconcileResult['reason'];
    market?: string;
  }): Promise<Result<CryptoReconcileResult, CryptoExchangeError>> {
    const startedAt = this.now();
    const checkpoint = this.repo.getRealtimeCheckpoint({
      accountId: input.accountId,
      exchange: input.exchange,
      stream: ORDER_STREAM,
    });
    const startTimeMs = Math.max(
      checkpoint?.lastEventAt ?? startedAt - CLOSED_ORDER_LOOKBACK_MS,
      startedAt - CLOSED_ORDER_LOOKBACK_MS,
    );

    const marketFilter = input.market !== undefined ? { market: input.market } : {};
    const open = await input.adapter.listOpenOrders({ ...marketFilter, limit: 200 });
    if (open.isErr()) return err(open.error);

    const closed = await input.adapter.listClosedOrders({
      ...marketFilter,
      startTimeMs,
      endTimeMs: startedAt,
      limit: 200,
    });
    if (closed.isErr()) return err(closed.error);

    let detailedOrders = 0;
    let persistedFills = 0;
    const seen = new Set<string>();
    const orders = [...open.value, ...closed.value];
    for (const order of orders) {
      if (seen.has(order.uuid)) continue;
      seen.add(order.uuid);
      const detail = shouldFetchOrderDetail(order)
        ? await input.adapter.getOrder({ uuid: order.uuid })
        : null;
      const snapshot = detail?.isOk() ? detail.value : order;
      if (detail?.isOk()) detailedOrders += 1;
      if (detail?.isErr()) {
        this.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.order-reconcile.detail-failed',
          payload: {
            accountId: input.accountId,
            exchange: input.exchange,
            uuid: order.uuid,
            kind: detail.error.kind,
            msg: detail.error.message,
          },
        });
      }
      persistedFills += this.repo.upsertOrderSnapshot({
        accountId: input.accountId,
        exchange: input.exchange,
        order: snapshot,
      }).fills;
    }

    this.repo.upsertRealtimeCheckpoint({
      accountId: input.accountId,
      exchange: input.exchange,
      stream: ORDER_STREAM,
      lastEventAt: startedAt,
      cursor: { reason: input.reason, market: input.market ?? null },
    });

    const result: CryptoReconcileResult = {
      accountId: input.accountId,
      exchange: input.exchange,
      reason: input.reason,
      openOrders: open.value.length,
      closedOrders: closed.value.length,
      detailedOrders,
      persistedFills,
      checkpointAt: startedAt,
    };
    this.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'crypto.order-reconcile.completed',
      payload: { ...result },
    });
    return ok(result);
  }
}

function shouldFetchOrderDetail(order: CryptoOrderSnapshot): boolean {
  if ((order.trades?.length ?? 0) > 0) return false;
  if (Number(order.executedVolume) > 0) return true;
  return order.state === 'done';
}

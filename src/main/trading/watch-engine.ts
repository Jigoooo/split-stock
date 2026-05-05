import { and, eq } from 'drizzle-orm';
import type { Result } from 'neverthrow';
import { watchOrders } from '../db/schema';
import {
  type ExecutionResult,
  type QueueEntry,
  rowToOrder,
  type WatchEngineOptions,
  type WatchError,
  type WatchHandler,
  type WatchOrder,
  type WatchOrderInput,
  type WatchSource,
  type WatchStatus,
} from './watch-engine-types';
import {
  cancelWatchOrder,
  expireStaleWatchOrders,
  listWatchOrders,
  loadWatchingOrders,
  pauseWatchOrder,
  resumeWatchOrder,
  updateWatchOrder,
  upsertWatchOrder,
} from './watch-order-store';

/** Phase R0: WatchEngine 은 stock-context 전용 (KIS broker). UPBIT 는 별도 crypto-* 모듈. */
const STOCK_BROKER = 'KIS' as const;

export type {
  ExecutionResult,
  WatchComparator,
  WatchEngineOptions,
  WatchError,
  WatchHandler,
  WatchOrder,
  WatchOrderInput,
  WatchOrderType,
  WatchQtyMode,
  WatchSide,
  WatchSource,
  WatchStatus,
} from './watch-engine-types';
export { WatchOrderInputSchema } from './watch-engine-types';

/**
 * 통합 자동감시주문 엔진.
 *
 * 흐름:
 *   1. register() → sourceRefId 기반 upsert + 인메모리 큐 동기
 *   2. tiered-quote-feed가 onPrice(pdno, price) 호출 → WATCHING 상태 행만 트리거
 *   3. 트리거 시 source별 handler 실행:
 *      - 성공 → status='EXECUTED', 큐에서 제거
 *      - 실패 → status='FAILED', last_failure_reason 기록, 큐에서 제거
 *   4. 만료 체크는 startCycle() 호출 시 60초 주기로 실행 → WATCHING/PAUSED 모두 EXPIRED
 */
export class WatchEngine {
  private readonly expiryCheckMs: number;
  private readonly queue = new Map<string, QueueEntry[]>(); // pdno → entries
  private readonly handlerRegistry = new Map<WatchSource, Map<number, WatchHandler>>();
  private readonly fallbackHandlers = new Map<WatchSource, WatchHandler>();
  private readonly globalEnabledByAccount = new Map<number, boolean>();
  private activeAccountId: number | null = null;
  private intervalHandle: { clear: () => void } | null = null;
  private disposed = false;

  constructor(private readonly opts: WatchEngineOptions) {
    this.expiryCheckMs = opts.expiryCheckMs ?? 60_000;
    for (const [source, handler] of Object.entries(opts.handlers ?? {})) {
      if (handler) this.fallbackHandlers.set(source as WatchSource, handler);
    }
    this.reload();
  }

  registerHandler(source: WatchSource, accountId: number, handler: WatchHandler): void {
    let perAccount = this.handlerRegistry.get(source);
    if (!perAccount) {
      perAccount = new Map<number, WatchHandler>();
      this.handlerRegistry.set(source, perAccount);
    }
    perAccount.set(accountId, handler);
  }

  unregisterHandler(source: WatchSource, accountId: number): void {
    const perAccount = this.handlerRegistry.get(source);
    if (!perAccount) return;
    perAccount.delete(accountId);
    if (perAccount.size === 0) this.handlerRegistry.delete(source);
  }

  setFallbackHandler(source: WatchSource, handler: WatchHandler): void {
    this.fallbackHandlers.set(source, handler);
  }

  setActiveAccountId(accountId: number | null): void {
    this.activeAccountId = accountId;
  }

  setGlobalEnabled(accountId: number, enabled: boolean): void {
    this.globalEnabledByAccount.set(accountId, enabled);
  }

  reload(): void {
    this.queue.clear();
    for (const order of loadWatchingOrders(this.opts.db)) {
      this.enqueueFromOrder(order);
    }
    this.notifyWatchingPdnosChanged();
  }

  register(input: WatchOrderInput): Result<WatchOrder, WatchError> {
    const result = upsertWatchOrder(this.opts.db, input);
    if (result.isErr()) return result;
    this.syncQueueFromOrder(result.value);
    return result;
  }

  cancel(id: number): Result<void, WatchError> {
    const result = cancelWatchOrder(this.opts.db, id);
    if (result.isErr()) return result;
    this.dequeue(id);
    this.notifyWatchingPdnosChanged();
    return result;
  }

  pause(id: number): Result<void, WatchError> {
    const result = pauseWatchOrder(this.opts.db, id);
    if (result.isErr()) return result;
    this.dequeue(id);
    this.notifyWatchingPdnosChanged();
    return result;
  }

  update(id: number, input: WatchOrderInput): Result<WatchOrder, WatchError> {
    const result = updateWatchOrder(this.opts.db, id, input);
    if (result.isErr()) return result;
    this.syncQueueFromOrder(result.value);
    return result;
  }

  resume(id: number): Result<WatchOrder, WatchError> {
    const result = resumeWatchOrder(this.opts.db, id);
    if (result.isErr()) return result;
    this.syncQueueFromOrder(result.value);
    return result;
  }

  list(
    filter: {
      status?: WatchStatus | undefined;
      source?: WatchSource | undefined;
      accountId?: number | undefined;
    } = {},
  ): WatchOrder[] {
    return listWatchOrders(this.opts.db, filter);
  }

  onPrice(pdno: string, price: number): void {
    if (this.disposed) return;
    const list = this.queue.get(pdno);
    if (!list || list.length === 0) return;
    for (const entry of [...list]) {
      if (entry.inFlight) continue;
      if (!this.isExecutionAllowed(entry.accountId)) continue;
      const matches =
        entry.comparator === 'LTE' ? price <= entry.targetPrice : price >= entry.targetPrice;
      if (!matches) continue;
      const coordinator = this.opts.inFlightCoordinator;
      if (coordinator && !coordinator.tryAcquire(entry.accountId, entry.pdno)) continue;
      entry.inFlight = true;
      void this.fire(entry, price);
    }
  }

  startCycle(): void {
    if (this.intervalHandle || this.disposed) return;
    this.intervalHandle = this.opts.timer.setInterval(() => {
      this.expireStale();
    }, this.expiryCheckMs);
  }

  stop(): void {
    this.disposed = true;
    this.intervalHandle?.clear();
    this.intervalHandle = null;
    this.queue.clear();
    this.notifyWatchingPdnosChanged();
  }

  size(): number {
    let n = 0;
    for (const list of this.queue.values()) n += list.length;
    return n;
  }

  private async fire(entry: QueueEntry, price: number): Promise<void> {
    const coordinator = this.opts.inFlightCoordinator;
    let stillQueued = true;
    try {
      const row = this.opts.db
        .select()
        .from(watchOrders)
        .where(and(eq(watchOrders.broker, STOCK_BROKER), eq(watchOrders.id, entry.id)))
        .get();
      if (!row) {
        this.dequeue(entry.id);
        stillQueued = false;
        return;
      }
      const order = rowToOrder(row);
      if (order.status !== 'WATCHING') {
        this.dequeue(entry.id);
        stillQueued = false;
        return;
      }
      if (!this.isExecutionAllowed(order.accountId)) return;

      this.opts.onTriggered?.(order);
      const result = await this.invokeHandler(order, price);
      const now = new Date();
      if (result.ok) {
        this.opts.db
          .update(watchOrders)
          .set({ status: 'EXECUTED', executedAt: now, updatedAt: now })
          .where(and(eq(watchOrders.broker, STOCK_BROKER), eq(watchOrders.id, order.id)))
          .run();
        this.dequeue(order.id);
        stillQueued = false;
        this.notifyWatchingPdnosChanged();
        this.opts.onExecuted?.({ ...order, status: 'EXECUTED', executedAt: now, updatedAt: now });
        return;
      }

      if (result.keepWatching) return;
      const reason = result.reason ?? 'unknown';
      this.opts.db
        .update(watchOrders)
        .set({ status: 'FAILED', lastFailureReason: reason, updatedAt: now })
        .where(and(eq(watchOrders.broker, STOCK_BROKER), eq(watchOrders.id, order.id)))
        .run();
      this.dequeue(order.id);
      stillQueued = false;
      this.notifyWatchingPdnosChanged();
      this.opts.onFailed?.(
        { ...order, status: 'FAILED', lastFailureReason: reason, updatedAt: now },
        reason,
      );
    } finally {
      if (stillQueued) entry.inFlight = false;
      coordinator?.release(entry.accountId, entry.pdno);
    }
  }

  private async invokeHandler(order: WatchOrder, price: number): Promise<ExecutionResult> {
    const perAccount = this.handlerRegistry.get(order.source);
    const handler = perAccount?.get(order.accountId) ?? this.fallbackHandlers.get(order.source);
    if (!handler) return { ok: false, reason: `handler 미등록: source=${order.source}` };
    try {
      return await handler(order, { price });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  private expireStale(): void {
    const expired = expireStaleWatchOrders(this.opts.db, this.opts.timer.now());
    for (const entry of expired) {
      this.dequeue(entry.id);
      this.notifyWatchingPdnosChanged();
      if (entry.expiredOrder) {
        this.opts.onExpired?.({ ...entry.expiredOrder, status: 'EXPIRED' });
      }
    }
  }

  private syncQueueFromOrder(order: WatchOrder): void {
    if (order.status === 'WATCHING') this.enqueueFromOrder(order);
    else this.dequeue(order.id);
    this.notifyWatchingPdnosChanged();
  }

  private enqueueFromOrder(order: WatchOrder): void {
    if (order.status !== 'WATCHING') return;
    this.enqueue({
      id: order.id,
      accountId: order.accountId,
      pdno: order.pdno,
      comparator: order.comparator,
      targetPrice: order.targetPrice,
      expiresAt: order.expiresAt ? order.expiresAt.getTime() : null,
      inFlight: false,
    });
  }

  private enqueue(entry: QueueEntry): void {
    const list = (this.queue.get(entry.pdno) ?? []).filter((queued) => queued.id !== entry.id);
    list.push(entry);
    this.queue.set(entry.pdno, list);
  }

  private dequeue(id: number): void {
    for (const [pdno, list] of this.queue.entries()) {
      const next = list.filter((e) => e.id !== id);
      if (next.length === 0) this.queue.delete(pdno);
      else if (next.length !== list.length) this.queue.set(pdno, next);
    }
  }

  private notifyWatchingPdnosChanged(): void {
    this.opts.onWatchingPdnosChanged?.(
      Array.from(this.queue.keys()).sort((a, b) => a.localeCompare(b)),
    );
  }

  private isExecutionAllowed(accountId: number): boolean {
    if (this.activeAccountId !== null && this.activeAccountId !== accountId) return false;
    return this.globalEnabledByAccount.get(accountId) !== false;
  }
}

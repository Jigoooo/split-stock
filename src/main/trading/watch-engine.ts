import { and, eq, inArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { Db } from '../db/client';
import { watchOrders } from '../db/schema';
import type { Timer } from '../brokers/core/types';
import type { InFlightCoordinator } from './in-flight-coordinator';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type WatchSource = 'BOOSTER' | 'PREBUY' | 'CUSTOM';
export type WatchSide = 'BUY' | 'SELL';
export type WatchComparator = 'LTE' | 'GTE';
export type WatchOrderType = 'MARKET' | 'LIMIT';
export type WatchQtyMode = 'QTY' | 'AMOUNT';
export type WatchStatus = 'WATCHING' | 'PAUSED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface WatchOrder {
  id: number;
  accountId: number;
  pdno: string;
  source: WatchSource;
  side: WatchSide;
  targetPrice: number;
  comparator: WatchComparator;
  orderType: WatchOrderType;
  qtyOrAmountMode: WatchQtyMode;
  qty: number | null;
  amountKrw: number | null;
  nth: number | null;
  sourceRefId: string | null;
  expiresAt: Date | null;
  status: WatchStatus;
  lastFailureReason: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  executedAt: Date | null;
}

export const WatchOrderInputSchema = z
  .object({
    accountId: z.number().int().positive(),
    pdno: z.string().regex(/^\d{6}$/),
    source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']),
    side: z.enum(['BUY', 'SELL']),
    targetPrice: z.number().int().positive(),
    comparator: z.enum(['LTE', 'GTE']),
    orderType: z.enum(['MARKET', 'LIMIT']),
    qtyOrAmountMode: z.enum(['QTY', 'AMOUNT']),
    qty: z.number().int().positive().optional(),
    amountKrw: z.number().int().positive().optional(),
    nth: z.number().int().positive().optional(),
    sourceRefId: z.string().min(1).max(120).optional(),
    /** unix epoch ms (Date 또는 number 모두 허용). undefined면 만료 없음. */
    expiresAt: z.union([z.number().int().positive(), z.date()]).optional(),
    metadata: z.string().optional(),
  })
  .refine(
    (v) =>
      v.qtyOrAmountMode === 'QTY'
        ? v.qty !== undefined && v.amountKrw === undefined
        : v.amountKrw !== undefined && v.qty === undefined,
    {
      message: 'mode가 QTY면 qty만, AMOUNT면 amount_krw만 지정하세요 (반대 필드는 비워야 함)',
    },
  );

export type WatchOrderInput = z.infer<typeof WatchOrderInputSchema>;

export type WatchError =
  | { kind: 'VALIDATION'; message: string }
  | { kind: 'NOT_FOUND'; id: number }
  | { kind: 'DB_ERROR'; cause: unknown };

export interface ExecutionResult {
  ok: boolean;
  /** 실패 시 사유 (FAILED 상태에 기록). */
  reason?: string;
  /** true면 상태를 바꾸지 않고 WATCHING 유지. */
  keepWatching?: boolean;
}

/**
 * source별 주문 발사 핸들러. 외부에서 주입.
 * 트리거 가격(price)과 watch row를 받아 실제 주문을 실행하고 성공/실패를 반환.
 * - 성공: { ok: true } → status='EXECUTED'
 * - 실패: { ok: false, reason } → status='FAILED', last_failure_reason 기록
 */
export type WatchHandler = (order: WatchOrder, ctx: { price: number }) => Promise<ExecutionResult>;

export interface WatchEngineOptions {
  db: Db;
  timer: Timer;
  /** 만료 체크 주기 ms (기본 60s). */
  expiryCheckMs?: number;
  /**
   * source별 글로벌 fallback 핸들러.
   *
   * 라우팅 우선순위:
   *   1. registerHandler(source, accountId, handler) 로 등록된 per-account 핸들러
   *   2. 본 글로벌 fallback (모든 계좌가 동일 핸들러를 공유하는 단일계좌 환경 호환)
   *   3. 둘 다 없으면 FAILED + reason='NO_HANDLER'
   *
   * @deprecated 다계좌 환경에서는 `registerHandler` 사용. 본 필드는 BC 보존용.
   */
  handlers?: Partial<Record<WatchSource, WatchHandler>>;
  /** 트리거/만료 등 라이프사이클 콜백 (옵션). */
  onTriggered?: (order: WatchOrder) => void;
  onExpired?: (order: WatchOrder) => void;
  onExecuted?: (order: WatchOrder) => void;
  onFailed?: (order: WatchOrder, reason: string) => void;
  onWatchingPdnosChanged?: (pdnos: string[]) => void;
  /** StrategyExecutionEngine 등 다른 source 와 cross-dedupe 위한 공유 coordinator (선택). */
  inFlightCoordinator?: InFlightCoordinator;
}

interface QueueEntry {
  id: number;
  accountId: number;
  pdno: string;
  /** 가격 비교는 인메모리에서. DB는 진실의 원천. */
  comparator: WatchComparator;
  targetPrice: number;
  expiresAt: number | null; // ms epoch
  inFlight: boolean;
}

const ACTIVE_CONTROL_STATUSES = ['WATCHING', 'PAUSED'] as const;

/* -------------------------------------------------------------------------- */
/*                                  Engine                                    */
/* -------------------------------------------------------------------------- */

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
  /**
   * source × accountId 단위 핸들러 라우팅 테이블.
   * 다계좌 환경에서 계좌별 감시 어댑터가 안전하게 공존하도록 분리.
   */
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

  /**
   * source × accountId 핸들러 등록.
   * 같은 (source, accountId) 재등록 시 이전 핸들러를 덮어쓴다.
   */
  registerHandler(source: WatchSource, accountId: number, handler: WatchHandler): void {
    let perAccount = this.handlerRegistry.get(source);
    if (!perAccount) {
      perAccount = new Map<number, WatchHandler>();
      this.handlerRegistry.set(source, perAccount);
    }
    perAccount.set(accountId, handler);
  }

  /**
   * source × accountId 핸들러 해제. dispose 시 stale closure 방지를 위해 호출.
   */
  unregisterHandler(source: WatchSource, accountId: number): void {
    const perAccount = this.handlerRegistry.get(source);
    if (!perAccount) return;
    perAccount.delete(accountId);
    if (perAccount.size === 0) this.handlerRegistry.delete(source);
  }

  setFallbackHandler(source: WatchSource, handler: WatchHandler): void {
    this.fallbackHandlers.set(source, handler);
  }

  /**
   * 현재 런타임에서 실제 주문을 내보낼 활성 계좌.
   * 앱은 한 시점에 하나의 env/account 조합만 실거래 가능하므로, 다른 계좌의 watch row 는
   * DB 에 남아 있어도 실행은 현재 활성 계좌로 제한한다.
   */
  setActiveAccountId(accountId: number | null): void {
    this.activeAccountId = accountId;
  }

  /**
   * 계좌 단위 전역 자동감시 ON/OFF.
   * false여도 row 상태는 유지하고, 런타임 실행만 차단한다.
   */
  setGlobalEnabled(accountId: number, enabled: boolean): void {
    this.globalEnabledByAccount.set(accountId, enabled);
  }

  /**
   * DB의 WATCHING 항목을 인메모리 큐로 다시 적재.
   * 앱 재시작 또는 외부에서 직접 DB를 변경한 경우 호출.
   */
  reload(): void {
    this.queue.clear();
    const rows = this.opts.db
      .select()
      .from(watchOrders)
      .where(eq(watchOrders.status, 'WATCHING'))
      .all();
    for (const row of rows) {
      this.enqueueFromOrder(rowToOrder(row));
    }
    this.notifyWatchingPdnosChanged();
  }

  register(input: WatchOrderInput): Result<WatchOrder, WatchError> {
    const parsed = WatchOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid' });
    }
    const v = parsed.data;
    const now = new Date();
    const expiresAt =
      v.expiresAt === undefined
        ? null
        : v.expiresAt instanceof Date
          ? v.expiresAt
          : new Date(v.expiresAt);

    try {
      const existing =
        v.sourceRefId === undefined
          ? null
          : this.opts.db
              .select()
              .from(watchOrders)
              .where(
                and(
                  eq(watchOrders.accountId, v.accountId),
                  eq(watchOrders.source, v.source),
                  eq(watchOrders.sourceRefId, v.sourceRefId),
                  inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES),
                ),
              )
              .get();

      if (existing) {
        const row = this.opts.db
          .update(watchOrders)
          .set({
            pdno: v.pdno,
            side: v.side,
            targetPrice: v.targetPrice,
            comparator: v.comparator,
            orderType: v.orderType,
            qtyOrAmountMode: v.qtyOrAmountMode,
            qty: v.qty ?? null,
            amountKrw: v.amountKrw ?? null,
            nth: v.nth ?? null,
            expiresAt,
            lastFailureReason: null,
            metadata: v.metadata ?? existing.metadata ?? null,
            updatedAt: now,
          })
          .where(eq(watchOrders.id, existing.id))
          .returning()
          .all()[0];
        if (!row) return err({ kind: 'DB_ERROR', cause: 'update returned no row' });

        const order = rowToOrder(row);
        if (order.status === 'WATCHING') this.enqueueFromOrder(order);
        else this.dequeue(order.id);
        this.notifyWatchingPdnosChanged();
        return ok(order);
      }

      const row = this.opts.db
        .insert(watchOrders)
        .values({
          accountId: v.accountId,
          pdno: v.pdno,
          source: v.source,
          side: v.side,
          targetPrice: v.targetPrice,
          comparator: v.comparator,
          orderType: v.orderType,
          qtyOrAmountMode: v.qtyOrAmountMode,
          qty: v.qty ?? null,
          amountKrw: v.amountKrw ?? null,
          nth: v.nth ?? null,
          sourceRefId: v.sourceRefId ?? null,
          expiresAt,
          status: 'WATCHING',
          lastFailureReason: null,
          metadata: v.metadata ?? null,
          createdAt: now,
          updatedAt: now,
          executedAt: null,
        })
        .returning()
        .all()[0];
      if (!row) return err({ kind: 'DB_ERROR', cause: 'insert returned no row' });

      const order = rowToOrder(row);
      this.enqueueFromOrder(order);
      this.notifyWatchingPdnosChanged();
      return ok(order);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  cancel(id: number): Result<void, WatchError> {
    try {
      const now = new Date();
      const res = this.opts.db
        .update(watchOrders)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(and(eq(watchOrders.id, id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)))
        .run();
      if (res.changes === 0) return err({ kind: 'NOT_FOUND', id });
      this.dequeue(id);
      this.notifyWatchingPdnosChanged();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  pause(id: number): Result<void, WatchError> {
    try {
      const res = this.opts.db
        .update(watchOrders)
        .set({ status: 'PAUSED', updatedAt: new Date() })
        .where(and(eq(watchOrders.id, id), eq(watchOrders.status, 'WATCHING')))
        .run();
      if (res.changes === 0) return err({ kind: 'NOT_FOUND', id });
      this.dequeue(id);
      this.notifyWatchingPdnosChanged();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  update(id: number, input: WatchOrderInput): Result<WatchOrder, WatchError> {
    const parsed = WatchOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid' });
    }
    const v = parsed.data;
    const expiresAt =
      v.expiresAt === undefined
        ? null
        : v.expiresAt instanceof Date
          ? v.expiresAt
          : new Date(v.expiresAt);
    try {
      const row = this.opts.db
        .update(watchOrders)
        .set({
          pdno: v.pdno,
          source: v.source,
          side: v.side,
          targetPrice: v.targetPrice,
          comparator: v.comparator,
          orderType: v.orderType,
          qtyOrAmountMode: v.qtyOrAmountMode,
          qty: v.qty ?? null,
          amountKrw: v.amountKrw ?? null,
          nth: v.nth ?? null,
          sourceRefId: v.sourceRefId ?? null,
          expiresAt,
          metadata: v.metadata ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(watchOrders.id, id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)))
        .returning()
        .all()[0];
      if (!row) return err({ kind: 'NOT_FOUND', id });
      const order = rowToOrder(row);
      if (order.status === 'WATCHING') this.enqueueFromOrder(order);
      else this.dequeue(order.id);
      this.notifyWatchingPdnosChanged();
      return ok(order);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  resume(id: number): Result<WatchOrder, WatchError> {
    try {
      const row = this.opts.db
        .update(watchOrders)
        .set({ status: 'WATCHING', updatedAt: new Date() })
        .where(and(eq(watchOrders.id, id), eq(watchOrders.status, 'PAUSED')))
        .returning()
        .all()[0];
      if (!row) return err({ kind: 'NOT_FOUND', id });
      const order = rowToOrder(row);
      this.enqueueFromOrder(order);
      this.notifyWatchingPdnosChanged();
      return ok(order);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  list(
    filter: {
      status?: WatchStatus | undefined;
      source?: WatchSource | undefined;
      accountId?: number | undefined;
    } = {},
  ): WatchOrder[] {
    const clauses = [];
    if (filter.status) clauses.push(eq(watchOrders.status, filter.status));
    if (filter.source) clauses.push(eq(watchOrders.source, filter.source));
    if (filter.accountId) clauses.push(eq(watchOrders.accountId, filter.accountId));
    const rows =
      clauses.length > 0
        ? this.opts.db
            .select()
            .from(watchOrders)
            .where(clauses.length === 1 ? clauses[0] : and(...clauses))
            .all()
        : this.opts.db.select().from(watchOrders).all();
    return rows.map(rowToOrder);
  }

  /**
   * 가격 신호 주입. tiered-quote-feed 등에서 ASIS price tick마다 호출.
   * 매칭되는 큐 항목이 있으면 source별 handler 실행 후 상태 갱신.
   */
  onPrice(pdno: string, price: number): void {
    if (this.disposed) return;
    const list = this.queue.get(pdno);
    if (!list || list.length === 0) return;
    // 스냅샷 — 트리거 중 dequeue가 호출돼도 안전
    for (const entry of [...list]) {
      if (entry.inFlight) continue;
      if (!this.isExecutionAllowed(entry.accountId)) continue;
      const matches =
        entry.comparator === 'LTE' ? price <= entry.targetPrice : price >= entry.targetPrice;
      if (!matches) continue;
      // cross-source dedupe: StrategyExecutionEngine 등 다른 엔진이 같은 (accountId, pdno)
      // 으로 fire 중이면 skip. coordinator 미주입 환경(테스트 등)에서는 무조건 통과.
      const coordinator = this.opts.inFlightCoordinator;
      if (coordinator && !coordinator.tryAcquire(entry.accountId, entry.pdno)) continue;
      entry.inFlight = true;
      void this.fire(entry, price);
    }
  }

  /** 만료 체크 타이머 시작 (60초 주기). */
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

  /* ----------------------------- internals ------------------------------ */

  private async fire(entry: QueueEntry, price: number): Promise<void> {
    // try/finally 로 모든 종료 경로(정상·DB throw·핸들러 throw)에서 entry.inFlight 와
    // coordinator 토큰을 복원·해제 보장. 누락 시 stuck inFlight=true 로 같은 entry 가
    // 다음 tick 부터 영원히 fire 되지 않는 회귀를 방지.
    const coordinator = this.opts.inFlightCoordinator;
    let stillQueued = true;
    try {
      const row = this.opts.db.select().from(watchOrders).where(eq(watchOrders.id, entry.id)).get();
      if (!row) {
        this.dequeue(entry.id);
        stillQueued = false;
        return;
      }
      const order = rowToOrder(row);
      // DB 레이스: 이미 다른 경로에서 상태가 바뀐 경우
      if (order.status !== 'WATCHING') {
        this.dequeue(entry.id);
        stillQueued = false;
        return;
      }
      if (!this.isExecutionAllowed(order.accountId)) {
        return;
      }

      this.opts.onTriggered?.(order);

      // 라우팅: 1) per-account → 2) 글로벌 fallback (deprecated, BC) → 3) FAILED
      const perAccount = this.handlerRegistry.get(order.source);
      const handler = perAccount?.get(order.accountId) ?? this.fallbackHandlers.get(order.source);
      let result: ExecutionResult;
      if (!handler) {
        result = { ok: false, reason: `handler 미등록: source=${order.source}` };
      } else {
        try {
          result = await handler(order, { price });
        } catch (e) {
          result = { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
      }

      const now = new Date();
      if (result.ok) {
        this.opts.db
          .update(watchOrders)
          .set({ status: 'EXECUTED', executedAt: now, updatedAt: now })
          .where(eq(watchOrders.id, order.id))
          .run();
        this.dequeue(order.id);
        stillQueued = false;
        this.notifyWatchingPdnosChanged();
        this.opts.onExecuted?.({ ...order, status: 'EXECUTED', executedAt: now, updatedAt: now });
      } else {
        if (result.keepWatching) {
          return;
        }
        const reason = result.reason ?? 'unknown';
        this.opts.db
          .update(watchOrders)
          .set({ status: 'FAILED', lastFailureReason: reason, updatedAt: now })
          .where(eq(watchOrders.id, order.id))
          .run();
        this.dequeue(order.id);
        stillQueued = false;
        this.notifyWatchingPdnosChanged();
        this.opts.onFailed?.(
          { ...order, status: 'FAILED', lastFailureReason: reason, updatedAt: now },
          reason,
        );
      }
    } finally {
      // 큐에 남은 entry 만 inFlight 복원 (dequeue 된 entry 는 무관).
      if (stillQueued) entry.inFlight = false;
      coordinator?.release(entry.accountId, entry.pdno);
    }
  }

  private expireStale(): void {
    const now = this.opts.timer.now();
    const rows = this.opts.db
      .select()
      .from(watchOrders)
      .where(inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES))
      .all()
      .filter((row) => row.expiresAt !== null && row.expiresAt.getTime() <= now);

    for (const row of rows) {
      const res = this.opts.db
        .update(watchOrders)
        .set({ status: 'EXPIRED', updatedAt: new Date(now) })
        .where(
          and(eq(watchOrders.id, row.id), inArray(watchOrders.status, ACTIVE_CONTROL_STATUSES)),
        )
        .run();
      this.dequeue(row.id);
      this.notifyWatchingPdnosChanged();
      if (res.changes > 0) {
        const next = this.opts.db
          .select()
          .from(watchOrders)
          .where(eq(watchOrders.id, row.id))
          .get();
        if (next) {
          const order = rowToOrder(next);
          this.opts.onExpired?.({ ...order, status: 'EXPIRED' });
        }
      }
    }
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

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function rowToOrder(r: typeof watchOrders.$inferSelect): WatchOrder {
  return {
    id: r.id,
    accountId: r.accountId,
    pdno: r.pdno,
    source: r.source as WatchSource,
    side: r.side as WatchSide,
    targetPrice: r.targetPrice,
    comparator: r.comparator as WatchComparator,
    orderType: r.orderType as WatchOrderType,
    qtyOrAmountMode: r.qtyOrAmountMode as WatchQtyMode,
    qty: r.qty,
    amountKrw: r.amountKrw,
    nth: r.nth,
    sourceRefId: r.sourceRefId,
    expiresAt: r.expiresAt,
    status: r.status as WatchStatus,
    lastFailureReason: r.lastFailureReason,
    metadata: r.metadata,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    executedAt: r.executedAt,
  };
}

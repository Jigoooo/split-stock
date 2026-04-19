import type { Timer } from '../kis/ws-client';
import type { PrebuyOrder, PrebuyRepo } from './prebuy-repo';
import type { WatchEngine, WatchHandler, WatchOrder } from './watch-engine';

export interface PrebuyWatcherOptions {
  timer: Timer;
  repo: PrebuyRepo;
  onTrigger: (order: PrebuyOrder, context: { price: number }) => void;
  onExpire?: (order: PrebuyOrder) => void;
  /** 만료 체크 주기 ms (기본 60s). */
  expiryCheckMs?: number;
}

/**
 * engine 위임 모드 옵션. engine + accountId 주입 시 통합 watch-engine 큐로 라우팅.
 * legacy 모드는 prebuy_orders 테이블만 사용 (BC).
 */
export interface PrebuyWatcherEngineOptions extends PrebuyWatcherOptions {
  engine: WatchEngine;
  accountId: number;
}

interface EngineMapping {
  order: PrebuyOrder;
  watchId: number;
}

/**
 * 예약 매수 감시자.
 *
 * 두 가지 모드:
 *   1. legacy: prebuy_orders 테이블만 사용. onPrice/reload/dispose API 그대로.
 *   2. engine: opts.engine + opts.accountId 주입 시 reload() 시점에 PENDING 항목을
 *      watch-engine에 PREBUY source로 register. UI(W3-5)에서 단일 큐로 노출.
 *
 * 두 모드 모두 onTrigger 콜백 시그니처(PrebuyOrder)는 호환 유지.
 */
export class PrebuyWatcher {
  private readonly expiryCheckMs: number;
  private watchMap = new Map<string, PrebuyOrder[]>(); // legacy: pdno → 여러 주문
  private engineMap = new Map<number, EngineMapping>(); // engine: prebuyId → mapping
  private timerHandle: { clear: () => void } | null = null;
  private readonly mode: 'legacy' | 'engine';
  private readonly engine: WatchEngine | null;
  private readonly accountId: number;

  constructor(private readonly opts: PrebuyWatcherOptions | PrebuyWatcherEngineOptions) {
    this.expiryCheckMs = opts.expiryCheckMs ?? 60_000;
    if ('engine' in opts && opts.engine) {
      this.mode = 'engine';
      this.engine = opts.engine;
      this.accountId = opts.accountId;
      installPrebuyHandler(this.engine, this.engineMap, this.opts);
    } else {
      this.mode = 'legacy';
      this.engine = null;
      this.accountId = 0;
    }
  }

  /** DB에서 PENDING 전체 로드 → 내부 맵 재구성. */
  reload(): void {
    const pending = this.opts.repo.listPending();
    if (this.mode === 'engine') {
      this.engineMap.clear();
      for (const o of pending) {
        this.registerToEngine(o);
      }
      return;
    }
    this.watchMap.clear();
    for (const o of pending) {
      const list = this.watchMap.get(o.pdno) ?? [];
      list.push(o);
      this.watchMap.set(o.pdno, list);
    }
    this.ensureExpiryLoop();
  }

  onPrice(pdno: string, price: number): void {
    if (this.mode === 'engine') {
      this.engine?.onPrice(pdno, price);
      return;
    }
    const list = this.watchMap.get(pdno);
    if (!list || list.length === 0) return;
    for (const order of [...list]) {
      if (price <= order.targetPrice) {
        this.opts.onTrigger(order, { price });
        this.removeFromMap(order);
      }
    }
  }

  dispose(): void {
    this.timerHandle?.clear();
    this.timerHandle = null;
    if (this.mode === 'engine') {
      for (const m of this.engineMap.values()) this.engine?.cancel(m.watchId);
      this.engineMap.clear();
      return;
    }
    this.watchMap.clear();
  }

  size(): number {
    if (this.mode === 'engine') return this.engineMap.size;
    let n = 0;
    for (const list of this.watchMap.values()) n += list.length;
    return n;
  }

  /* ---------------------------- legacy mode ----------------------------- */

  private ensureExpiryLoop(): void {
    if (this.timerHandle) return;
    this.timerHandle = this.opts.timer.setInterval(() => {
      this.expireStale();
    }, this.expiryCheckMs);
  }

  private expireStale(): void {
    const now = this.opts.timer.now();
    for (const [pdno, list] of Array.from(this.watchMap.entries())) {
      for (const order of [...list]) {
        if (order.validUntil.getTime() <= now) {
          this.opts.repo.markExpired(order.id);
          this.opts.onExpire?.(order);
          this.removeFromMap(order);
        }
      }
      if ((this.watchMap.get(pdno)?.length ?? 0) === 0) {
        this.watchMap.delete(pdno);
      }
    }
  }

  private removeFromMap(order: PrebuyOrder): void {
    const list = this.watchMap.get(order.pdno);
    if (!list) return;
    const next = list.filter((o) => o.id !== order.id);
    if (next.length === 0) this.watchMap.delete(order.pdno);
    else this.watchMap.set(order.pdno, next);
  }

  /* ---------------------------- engine mode ----------------------------- */

  private registerToEngine(order: PrebuyOrder): void {
    if (!this.engine) return;
    const r = this.engine.register({
      accountId: this.accountId,
      pdno: order.pdno,
      source: 'PREBUY',
      side: 'BUY',
      targetPrice: order.targetPrice,
      comparator: 'LTE',
      orderType: 'LIMIT',
      qtyOrAmountMode: 'AMOUNT',
      amountKrw: order.amountKrw,
      nth: 1,
      expiresAt: order.validUntil,
    });
    if (r.isOk()) {
      this.engineMap.set(order.id, { order, watchId: r.value.id });
    }
  }
}

/**
 * PREBUY 핸들러를 engine에 등록.
 * 트리거 시 외부 onTrigger 콜백 호출 + prebuy_orders.markFilled로 BC 유지.
 * 핸들러는 항상 ok=true 반환 (실제 주문 실행은 onTrigger 안에서 처리).
 */
function installPrebuyHandler(
  engine: WatchEngine,
  engineMap: Map<number, EngineMapping>,
  opts: PrebuyWatcherOptions,
): void {
  const handler: WatchHandler = async (order: WatchOrder, ctx) => {
    const found = Array.from(engineMap.values()).find((m) => m.watchId === order.id);
    if (found) {
      opts.onTrigger(found.order, { price: ctx.price });
      opts.repo.markFilled(found.order.id);
      engineMap.delete(found.order.id);
    }
    return { ok: true };
  };
  (engine as unknown as { opts: { handlers: Record<string, WatchHandler> } }).opts.handlers.PREBUY =
    handler;
}

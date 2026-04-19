import type { Timer } from '../kis/ws-client';
import type { WatchEngine, WatchHandler, WatchOrder } from './watch-engine';

export interface BoosterTask {
  pdno: string;
  lastFilledPrice: number;
  /** 재매수 트리거 하락률 (0.01 = 1%). 0 또는 음수면 즉시 트리거. */
  boosterPct: number;
  amountKrw: number;
  /** ms absolute. 넘기면 자동 해제. */
  expiresAt?: number;
}

export interface BoosterWatcherOptions {
  timer: Timer;
  onTrigger: (task: BoosterTask, context: { price: number; at: number }) => void;
  onExpire?: (task: BoosterTask) => void;
}

/**
 * 통합 watch-engine 위임 모드용 옵션. engine + accountId가 있으면 engine 모드로 동작.
 * 없으면 인메모리 legacy 모드 (외부 호출자 호환).
 */
export interface BoosterWatcherEngineOptions extends BoosterWatcherOptions {
  engine: WatchEngine;
  accountId: number;
}

interface LegacyEntry {
  task: BoosterTask;
  triggered: boolean;
  disposed: boolean;
  expireHandle: { clear: () => void } | null;
}

interface EngineEntry {
  task: BoosterTask;
  watchId: number;
}

/**
 * 수익부스터 — 1차 전량 매도 후 lastFilledPrice*(1-boosterPct) 도달 시 재매수 유도.
 *
 * 두 가지 모드:
 *   1. legacy 인메모리 (기본): 외부 인터페이스 호환. onPrice/cancel/dispose 그대로 동작.
 *   2. engine 위임: opts.engine + opts.accountId 주입 시 통합 watch-engine 큐로 라우팅.
 *      W3-5 watch-board가 단일 데이터소스(WATCH_ORDERS)에서 BOOSTER 항목을 함께 노출.
 *
 * boosterPct <= 0이면 register 즉시 트리거 (홀딩 유지 효과).
 */
export class BoosterWatcher {
  private readonly legacyEntries = new Map<string, LegacyEntry>();
  private readonly engineEntries = new Map<string, EngineEntry>();
  private readonly mode: 'legacy' | 'engine';
  private readonly engine: WatchEngine | null;
  private readonly accountId: number;

  constructor(private readonly opts: BoosterWatcherOptions | BoosterWatcherEngineOptions) {
    if ('engine' in opts && opts.engine) {
      this.mode = 'engine';
      this.engine = opts.engine;
      this.accountId = opts.accountId;
      installBoosterHandler(this.engine, this.engineEntries, this.opts);
    } else {
      this.mode = 'legacy';
      this.engine = null;
      this.accountId = 0;
    }
  }

  register(task: BoosterTask): void {
    if (this.mode === 'engine') {
      this.registerEngine(task);
      return;
    }
    this.registerLegacy(task);
  }

  onPrice(pdno: string, price: number): void {
    if (this.mode === 'engine') {
      this.engine?.onPrice(pdno, price);
      return;
    }
    const entry = this.legacyEntries.get(pdno);
    if (!entry || entry.disposed || entry.triggered) return;
    const threshold = entry.task.lastFilledPrice * (1 - entry.task.boosterPct);
    if (price <= threshold) {
      this.triggerLegacy(entry, price);
    }
  }

  cancel(pdno: string): void {
    if (this.mode === 'engine') {
      const entry = this.engineEntries.get(pdno);
      if (!entry) return;
      this.engine?.cancel(entry.watchId);
      this.engineEntries.delete(pdno);
      return;
    }
    const entry = this.legacyEntries.get(pdno);
    if (!entry) return;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.legacyEntries.delete(pdno);
  }

  size(): number {
    return this.mode === 'engine' ? this.engineEntries.size : this.legacyEntries.size;
  }

  dispose(): void {
    if (this.mode === 'engine') {
      for (const e of this.engineEntries.values()) this.engine?.cancel(e.watchId);
      this.engineEntries.clear();
      return;
    }
    for (const e of this.legacyEntries.values()) {
      e.disposed = true;
      e.expireHandle?.clear();
    }
    this.legacyEntries.clear();
  }

  /* ---------------------------- legacy mode ----------------------------- */

  private registerLegacy(task: BoosterTask): void {
    const existing = this.legacyEntries.get(task.pdno);
    if (existing) existing.expireHandle?.clear();

    const entry: LegacyEntry = { task, triggered: false, disposed: false, expireHandle: null };
    this.legacyEntries.set(task.pdno, entry);

    if (task.expiresAt !== undefined) {
      const delay = Math.max(0, task.expiresAt - this.opts.timer.now());
      entry.expireHandle = this.opts.timer.setTimeout(() => {
        if (entry.disposed || entry.triggered) return;
        entry.disposed = true;
        this.legacyEntries.delete(task.pdno);
        this.opts.onExpire?.(task);
      }, delay);
    }

    if (task.boosterPct <= 0) {
      this.triggerLegacy(entry, task.lastFilledPrice);
    }
  }

  private triggerLegacy(entry: LegacyEntry, price: number): void {
    entry.triggered = true;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.legacyEntries.delete(entry.task.pdno);
    this.opts.onTrigger(entry.task, { price, at: this.opts.timer.now() });
  }

  /* ---------------------------- engine mode ----------------------------- */

  private registerEngine(task: BoosterTask): void {
    if (!this.engine) return;
    const threshold =
      task.boosterPct <= 0
        ? task.lastFilledPrice
        : Math.floor(task.lastFilledPrice * (1 - task.boosterPct));

    const existing = this.engineEntries.get(task.pdno);
    if (existing) {
      this.engine.cancel(existing.watchId);
      this.engineEntries.delete(task.pdno);
    }

    const r = this.engine.register({
      accountId: this.accountId,
      pdno: task.pdno,
      source: 'BOOSTER',
      side: 'BUY',
      targetPrice: threshold,
      comparator: 'LTE',
      orderType: 'LIMIT',
      qtyOrAmountMode: 'AMOUNT',
      amountKrw: task.amountKrw,
      nth: 1,
      expiresAt: task.expiresAt,
    });
    if (r.isOk()) {
      this.engineEntries.set(task.pdno, { task, watchId: r.value.id });
    }
  }
}

/**
 * BOOSTER 핸들러를 engine에 등록.
 * 트리거 시 외부 onTrigger 콜백을 호출해 ASIS의 1차 재매수 후속처리(주문 발사 등)를 위임.
 * onTrigger는 동기로 가정하므로, 핸들러는 항상 ok=true 반환.
 * 실제 주문 실패는 외부 onTrigger 핸들러 안에서 처리하고, 필요시 별도 watch_orders 행을 새로 등록.
 */
function installBoosterHandler(
  engine: WatchEngine,
  entries: Map<string, EngineEntry>,
  opts: BoosterWatcherOptions,
): void {
  const handler: WatchHandler = async (order: WatchOrder, ctx) => {
    const found = Array.from(entries.values()).find((e) => e.watchId === order.id);
    if (found) {
      opts.onTrigger(found.task, { price: ctx.price, at: opts.timer.now() });
      entries.delete(found.task.pdno);
    }
    return { ok: true };
  };
  // engine 옵션 객체에 직접 BOOSTER 핸들러 주입.
  (
    engine as unknown as { opts: { handlers: Record<string, WatchHandler> } }
  ).opts.handlers.BOOSTER = handler;
}

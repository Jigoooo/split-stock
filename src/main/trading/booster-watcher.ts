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
  /**
   * 1차 매도 시점에 보존하는 strategy 스냅샷.
   * 부스터 트리거 후 재매수 lot을 동일 차수 정의로 복원하기 위함 (Wave 1 verifier H1).
   * 타입은 호출자가 결정 — 라우터/테스트가 간단한 형태로 전달 가능하도록 unknown 유지.
   */
  strategySnapshot?: unknown;
}

export interface BoosterTriggerContext {
  price: number;
  at: number;
  /** register 시점에 보존된 strategy 스냅샷 — 부스터 트리거 시 caller가 복원에 사용. */
  strategySnapshot?: unknown;
}

export interface BoosterWatcherOptions {
  timer: Timer;
  onTrigger: (task: BoosterTask, context: BoosterTriggerContext) => unknown | Promise<unknown>;
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
      this.engine.registerHandler('BOOSTER', this.accountId, this.makeHandler());
    } else {
      this.mode = 'legacy';
      this.engine = null;
      this.accountId = 0;
    }
  }

  /**
   * 본 인스턴스의 (accountId 한정) BOOSTER 핸들러.
   * register 시점 task를 유지하지 못한 상황(재시작 후 reload)도 metadata 로 복원한다.
   */
  private makeHandler(): WatchHandler {
    return async (order: WatchOrder, ctx) => {
      const task = this.resolveTask(order);
      if (!task) return { ok: false, reason: 'BOOSTER_METADATA_INVALID' };
      await this.opts.onTrigger(task, {
        price: ctx.price,
        at: this.opts.timer.now(),
        strategySnapshot: task.strategySnapshot,
      });
      this.engineEntries.delete(task.pdno);
      return { ok: true };
    };
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
      this.engineEntries.clear();
      // runtime detach는 terminal cancel이 아니라 핸들러 해제만 수행.
      this.engine?.unregisterHandler('BOOSTER', this.accountId);
      return;
    }
    for (const entry of this.legacyEntries.values()) {
      entry.disposed = true;
      entry.expireHandle?.clear();
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
    void this.opts.onTrigger(entry.task, {
      price,
      at: this.opts.timer.now(),
      strategySnapshot: entry.task.strategySnapshot,
    });
  }

  /* ---------------------------- engine mode ----------------------------- */

  private registerEngine(task: BoosterTask): void {
    if (!this.engine) return;
    const threshold =
      task.boosterPct <= 0
        ? task.lastFilledPrice
        : Math.floor(task.lastFilledPrice * (1 - task.boosterPct));

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
      sourceRefId: task.pdno,
      expiresAt: task.expiresAt,
      metadata: JSON.stringify(task),
    });
    if (r.isOk()) {
      this.engineEntries.set(task.pdno, { task, watchId: r.value.id });
    }
  }

  private resolveTask(order: WatchOrder): BoosterTask | null {
    const current = this.engineEntries.get(order.pdno)?.task;
    if (current) return current;
    if (!order.metadata) return null;
    try {
      const parsed = JSON.parse(order.metadata) as Partial<BoosterTask>;
      if (
        typeof parsed.pdno !== 'string' ||
        typeof parsed.lastFilledPrice !== 'number' ||
        typeof parsed.boosterPct !== 'number' ||
        typeof parsed.amountKrw !== 'number'
      ) {
        return null;
      }
      return {
        pdno: parsed.pdno,
        lastFilledPrice: parsed.lastFilledPrice,
        boosterPct: parsed.boosterPct,
        amountKrw: parsed.amountKrw,
        ...(parsed.expiresAt !== undefined ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.strategySnapshot !== undefined
          ? { strategySnapshot: parsed.strategySnapshot }
          : {}),
      };
    } catch {
      return null;
    }
  }
}

import type { Timer } from '../brokers/core/types';
import type { PrebuyOrder, PrebuyRepo } from './prebuy-repo';
import type { WatchEngine, WatchHandler, WatchOrder } from './watch-engine';

export interface PrebuyWatcherOptions {
  timer: Timer;
  repo: PrebuyRepo;
  onTrigger: (order: PrebuyOrder, context: { price: number }) => unknown | Promise<unknown>;
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
      this.engine.registerHandler('PREBUY', this.accountId, this.makeHandler());
    } else {
      this.mode = 'legacy';
      this.engine = null;
      this.accountId = 0;
    }
  }

  /**
   * 본 인스턴스(accountId 한정) PREBUY 핸들러.
   * sourceRefId를 prebuy_orders.id 로 사용해 재시작 후에도 source row를 복원한다.
   */
  private makeHandler(): WatchHandler {
    return async (order: WatchOrder, ctx) => {
      const prebuyId = Number(order.sourceRefId);
      if (!Number.isInteger(prebuyId) || prebuyId <= 0) {
        return { ok: false, reason: 'PREBUY_SOURCE_REF_INVALID' };
      }
      const source = this.opts.repo.getById(prebuyId);
      if (!source) {
        return { ok: false, reason: 'PREBUY_SOURCE_NOT_FOUND' };
      }
      if (source.accountId !== null && source.accountId !== this.accountId) {
        return { ok: false, reason: 'PREBUY_ACCOUNT_MISMATCH' };
      }
      if (source.status !== 'PENDING') {
        return { ok: false, reason: `PREBUY_STATUS_${source.status}` };
      }
      await this.opts.onTrigger(source, { price: ctx.price });
      this.opts.repo.markFilled(source.id);
      return { ok: true };
    };
  }

  /** DB에서 PENDING 전체 로드 → 내부 맵 재구성. */
  reload(): void {
    const pending = this.opts.repo.listPending();
    if (this.mode === 'engine') {
      for (const order of pending) {
        if (order.accountId !== this.accountId) continue;
        this.registerToEngine(order);
      }
      return;
    }
    this.watchMap.clear();
    for (const order of pending) {
      const list = this.watchMap.get(order.pdno) ?? [];
      list.push(order);
      this.watchMap.set(order.pdno, list);
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
        void this.opts.onTrigger(order, { price });
        this.removeFromMap(order);
      }
    }
  }

  dispose(): void {
    this.timerHandle?.clear();
    this.timerHandle = null;
    if (this.mode === 'engine') {
      // runtime detach는 terminal cancel이 아니라 handler 해제만 수행.
      this.engine?.unregisterHandler('PREBUY', this.accountId);
      return;
    }
    this.watchMap.clear();
  }

  size(): number {
    if (this.mode === 'engine') {
      return this.opts.repo.listPending().filter((order) => order.accountId === this.accountId)
        .length;
    }
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
    this.engine.register({
      accountId: this.accountId,
      pdno: order.pdno,
      source: 'PREBUY',
      side: 'BUY',
      targetPrice: order.targetPrice,
      comparator: 'LTE',
      orderType: 'LIMIT',
      qtyOrAmountMode: 'AMOUNT',
      amountKrw: order.amountKrw,
      nth: undefined,
      sourceRefId: String(order.id),
      expiresAt: order.validUntil,
    });
  }
}

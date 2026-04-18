import type { Timer } from '../kis/ws-client';
import type { PrebuyOrder, PrebuyRepo } from './prebuy-repo';

export interface PrebuyWatcherOptions {
  timer: Timer;
  repo: PrebuyRepo;
  onTrigger: (order: PrebuyOrder, context: { price: number }) => void;
  onExpire?: (order: PrebuyOrder) => void;
  /** 만료 체크 주기 ms (기본 60s). */
  expiryCheckMs?: number;
}

/**
 * 예약 매수 감시자.
 * - onPrice(pdno, price) 호출로 가격 신호 주입 → targetPrice 도달 시 onTrigger 콜백
 * - 주기적으로 만료된 PENDING 항목 markExpired + onExpire
 * - DB의 PENDING 목록은 호출측이 start() 시점에 주입(reload() 호출)
 */
export class PrebuyWatcher {
  private readonly expiryCheckMs: number;
  private watchMap = new Map<string, PrebuyOrder[]>(); // pdno → 여러 주문 가능성(같은 pdno 제한 있지만 안전)
  private timerHandle: { clear: () => void } | null = null;

  constructor(private readonly opts: PrebuyWatcherOptions) {
    this.expiryCheckMs = opts.expiryCheckMs ?? 60_000;
  }

  /** DB에서 PENDING 전체 로드 → 내부 맵 재구성. */
  reload(): void {
    const pending = this.opts.repo.listPending();
    this.watchMap.clear();
    for (const o of pending) {
      const list = this.watchMap.get(o.pdno) ?? [];
      list.push(o);
      this.watchMap.set(o.pdno, list);
    }
    this.ensureExpiryLoop();
  }

  onPrice(pdno: string, price: number): void {
    const list = this.watchMap.get(pdno);
    if (!list || list.length === 0) return;
    for (const order of [...list]) {
      if (price <= order.targetPrice) {
        this.opts.onTrigger(order, { price });
        // 호출측이 markFilled를 책임지지만, 중복 트리거 방지를 위해 감시 제거
        this.removeFromMap(order);
      }
    }
  }

  dispose(): void {
    this.timerHandle?.clear();
    this.timerHandle = null;
    this.watchMap.clear();
  }

  size(): number {
    let n = 0;
    for (const list of this.watchMap.values()) n += list.length;
    return n;
  }

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
}

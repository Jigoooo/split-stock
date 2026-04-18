import type { Timer } from '../kis/ws-client';

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

interface Entry {
  task: BoosterTask;
  triggered: boolean;
  disposed: boolean;
  expireHandle: { clear: () => void } | null;
}

/**
 * 수익부스터 — 1차 전량 매도 후 lastFilledPrice*(1-boosterPct) 도달 시 재매수 유도.
 * 가격 신호는 TieredQuoteFeed 등 외부에서 push(onPrice)로 주입.
 * boosterPct <= 0이면 register 즉시 트리거 (홀딩 유지 효과).
 */
export class BoosterWatcher {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly opts: BoosterWatcherOptions) {}

  register(task: BoosterTask): void {
    const existing = this.entries.get(task.pdno);
    if (existing) {
      existing.expireHandle?.clear();
    }
    const entry: Entry = {
      task,
      triggered: false,
      disposed: false,
      expireHandle: null,
    };
    this.entries.set(task.pdno, entry);

    if (task.expiresAt !== undefined) {
      const delay = Math.max(0, task.expiresAt - this.opts.timer.now());
      entry.expireHandle = this.opts.timer.setTimeout(() => {
        if (entry.disposed || entry.triggered) return;
        entry.disposed = true;
        this.entries.delete(task.pdno);
        this.opts.onExpire?.(task);
      }, delay);
    }

    // 즉시 트리거 조건: boosterPct <= 0
    if (task.boosterPct <= 0) {
      this.trigger(entry, task.lastFilledPrice);
    }
  }

  onPrice(pdno: string, price: number): void {
    const entry = this.entries.get(pdno);
    if (!entry || entry.disposed || entry.triggered) return;
    const threshold = entry.task.lastFilledPrice * (1 - entry.task.boosterPct);
    if (price <= threshold) {
      this.trigger(entry, price);
    }
  }

  cancel(pdno: string): void {
    const entry = this.entries.get(pdno);
    if (!entry) return;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.entries.delete(pdno);
  }

  size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.disposed = true;
      e.expireHandle?.clear();
    }
    this.entries.clear();
  }

  private trigger(entry: Entry, price: number): void {
    entry.triggered = true;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.entries.delete(entry.task.pdno);
    this.opts.onTrigger(entry.task, { price, at: this.opts.timer.now() });
  }
}

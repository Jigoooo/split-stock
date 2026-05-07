import type { Timer } from '../kis/ws-client';

/**
 * NM-004 수익 부스터 — 1차 전량 매도 후 lastFilledPrice * (1 - boosterPct) 도달 시
 * 1차 재매수를 트리거. 매직스플릿 4-2 사양에 대응.
 *
 * **메모리 휘발성 (MVP)**: 앱 재시작 시 모든 task 가 초기화된다. 영속화는 향후 별도 phase.
 * b7c7c7b 직후 watch-engine 이 예약매수(PREBUY) 전용으로 축소되어, 부스터는 watch_orders
 * 외부의 standalone runtime 서비스로 운영한다 (= "reservation-buy-only watch contract" 준수).
 */
export interface BoosterTask {
  pdno: string;
  accountId: number;
  /** 1차 매도 시점의 마지막 체결 가격. 이 값을 기준으로 트리거 임계값 계산. */
  lastFilledPrice: number;
  /** 재매수 트리거 하락률 (0.01 = 1%). 0 이하면 즉시 트리거. */
  boosterPct: number;
  /** 1차 재매수 금액 (KRW). buyRules[0].amountKrw 의 snapshot. */
  amountKrw: number;
  /** ms 절대 시각. 넘기면 자동 해제. undefined 면 만료 없음. */
  expiresAt?: number;
}

export interface BoosterTriggerContext {
  /** 트리거된 시점 가격 (lastFilledPrice * (1 - boosterPct) 이하로 도달). */
  price: number;
  /** ms 절대 시각. */
  at: number;
}

export interface BoosterWatcherOptions {
  timer: Timer;
  onTrigger: (task: BoosterTask, context: BoosterTriggerContext) => unknown | Promise<unknown>;
  onExpire?: (task: BoosterTask) => void;
}

interface Entry {
  task: BoosterTask;
  triggered: boolean;
  disposed: boolean;
  expireHandle: { clear: () => void } | null;
}

/**
 * 메모리 내 가격 감시기. (accountId, pdno) 조합으로 active task 1개만 유지.
 *
 * - register({...}) 로 task 등록. 이미 active 면 교체.
 * - onPrice(pdno, price) 를 KIS WS price feed 에서 호출 → 임계값 도달 시 onTrigger.
 * - cancel(accountId, pdno) 로 수동 해제.
 * - boosterPct <= 0 이면 register 즉시 onTrigger (홀딩 유지 효과).
 */
export class BoosterWatcher {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly opts: BoosterWatcherOptions) {}

  register(task: BoosterTask): void {
    const key = entryKey(task.accountId, task.pdno);
    const existing = this.entries.get(key);
    if (existing) existing.expireHandle?.clear();

    const entry: Entry = { task, triggered: false, disposed: false, expireHandle: null };
    this.entries.set(key, entry);

    if (task.expiresAt !== undefined) {
      const delay = Math.max(0, task.expiresAt - this.opts.timer.now());
      entry.expireHandle = this.opts.timer.setTimeout(() => {
        if (entry.disposed || entry.triggered) return;
        entry.disposed = true;
        this.entries.delete(key);
        this.opts.onExpire?.(task);
      }, delay);
    }

    if (task.boosterPct <= 0) {
      this.trigger(entry, task.lastFilledPrice);
    }
  }

  onPrice(accountId: number, pdno: string, price: number): void {
    const entry = this.entries.get(entryKey(accountId, pdno));
    if (!entry || entry.disposed || entry.triggered) return;
    const threshold = entry.task.lastFilledPrice * (1 - entry.task.boosterPct);
    if (price <= threshold) {
      this.trigger(entry, price);
    }
  }

  cancel(accountId: number, pdno: string): void {
    const key = entryKey(accountId, pdno);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.entries.delete(key);
  }

  has(accountId: number, pdno: string): boolean {
    const entry = this.entries.get(entryKey(accountId, pdno));
    return entry !== undefined && !entry.disposed && !entry.triggered;
  }

  list(): readonly BoosterTask[] {
    return [...this.entries.values()].filter((e) => !e.disposed && !e.triggered).map((e) => e.task);
  }

  size(): number {
    return this.list().length;
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.disposed = true;
      entry.expireHandle?.clear();
    }
    this.entries.clear();
  }

  private trigger(entry: Entry, price: number): void {
    entry.triggered = true;
    entry.disposed = true;
    entry.expireHandle?.clear();
    this.entries.delete(entryKey(entry.task.accountId, entry.task.pdno));
    void this.opts.onTrigger(entry.task, {
      price,
      at: this.opts.timer.now(),
    });
  }
}

function entryKey(accountId: number, pdno: string): string {
  return `${accountId}::${pdno}`;
}

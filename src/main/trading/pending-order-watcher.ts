import type { Timer } from '../kis/ws-client';

export type OrderSide = 'BUY' | 'SELL';

export interface PendingOrderKey {
  pdno: string;
  side: OrderSide;
  nth: number;
}

export interface PendingOrderRegistration extends PendingOrderKey {
  odno: string;
  orgNo?: string;
}

export interface PendingOrderWatcherOptions {
  timer: Timer;
  timeoutMs: number;
  /** null = 무제한, 1..30 = 유한 재시도. */
  maxRetries: number | null;
  onExpire: (entry: PendingOrderRegistration, attempt: number) => void;
  onLimitReached: (entry: PendingOrderRegistration) => void;
}

function keyId(k: PendingOrderKey): string {
  return `${k.pdno}:${k.side}:${k.nth}`;
}

interface Entry {
  reg: PendingOrderRegistration;
  handle: { clear: () => void } | null;
  attempts: number;
  disposed: boolean;
}

/**
 * 지정가 주문의 미체결 감시 — 타임아웃 시 onExpire 콜백으로 취소/재주문 유도.
 * 실제 KIS 취소 호출은 호출측이 onExpire 내부에서 `cancelOrRevise` 등을 실행.
 *
 * 핵심 불변식:
 * - (pdno, side, nth) 유일 — 같은 차수 중복 등록은 noop(기존 timer 유지)
 * - cancel(key) → timer 해제 + attempts 초기화
 * - 만료 시 onExpire 호출 + attempts++ → maxRetries 도달 시 onLimitReached로 알림 후 해제
 * - dispose() → 모든 타이머 해제
 */
export class PendingOrderWatcher {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly opts: PendingOrderWatcherOptions) {}

  register(reg: PendingOrderRegistration): void {
    const id = keyId(reg);
    if (this.entries.has(id)) return; // 이미 감시 중
    const entry: Entry = { reg, handle: null, attempts: 0, disposed: false };
    this.entries.set(id, entry);
    this.arm(entry);
  }

  /**
   * 호출측이 체결/사용자 취소를 인지하여 감시 해제.
   */
  cancel(key: PendingOrderKey): void {
    const id = keyId(key);
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.disposed = true;
    entry.handle?.clear();
    this.entries.delete(id);
  }

  /**
   * 호출측이 onExpire로부터 재주문까지 성공한 경우 — 타이머 재무장 (attempts++ 유지).
   */
  rearm(key: PendingOrderKey): void {
    const id = keyId(key);
    const entry = this.entries.get(id);
    if (!entry || entry.disposed) return;
    this.arm(entry);
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.disposed = true;
      e.handle?.clear();
    }
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private arm(entry: Entry): void {
    entry.handle?.clear();
    entry.handle = this.opts.timer.setTimeout(() => {
      if (entry.disposed) return;
      entry.attempts += 1;
      this.opts.onExpire(entry.reg, entry.attempts);
      if (this.opts.maxRetries !== null && entry.attempts >= this.opts.maxRetries) {
        this.opts.onLimitReached(entry.reg);
        this.cancel(entry.reg);
      }
    }, this.opts.timeoutMs);
  }
}

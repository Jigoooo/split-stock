import type { ReorderMode } from '../db/settings-repo';
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
  /** 재주문 시 사용할 수량. */
  qty?: number;
  /** 재주문 시 사용할 최근 체결가 (LIMIT_AT_LAST_PRICE 모드). */
  lastPrice?: number;
  /** per-order accountId — 재주문 콜백에 전달. */
  accountId?: number;
}

export interface PendingOrderWatcherOptions {
  timer: Timer;
  timeoutMs: number;
  /** null = 무제한, 1..30 = 유한 재시도. */
  maxRetries: number | null;
  onExpire: (entry: PendingOrderRegistration, attempt: number) => void;
  onLimitReached: (entry: PendingOrderRegistration) => void;
  /**
   * NM-017: 취소 후 재주문 모드.
   * - 'NONE': 취소만 하고 재주문하지 않음 (기존 동작).
   * - 'MARKET': 시장가로 재주문.
   * - 'LIMIT_AT_LAST_PRICE': 현재 시세(lastPrice) 기준 지정가 재주문.
   *
   * onExpire 콜백 이후 이 옵션을 활용해 재주문 여부를 결정한다.
   * 실제 주문 발사는 onReorder 콜백에 위임 (watcher 자체는 주문 API를 직접 호출하지 않음).
   */
  reorderMode?: ReorderMode;
  /**
   * 재주문 콜백 — reorderMode가 NONE이 아닐 때 onExpire 직후 호출.
   * 호출측이 실제 주문 API를 실행하고 새 odno를 반환해야 한다.
   * 반환값이 null/undefined이면 재무장(rearm)을 스킵한다.
   */
  onReorder?: (
    entry: PendingOrderRegistration,
    mode: Exclude<ReorderMode, 'NONE'>,
    attempt: number,
  ) => Promise<string | null | undefined>;
  /**
   * A4: rearm 지수 백오프. 다음 만료 까지의 timeout 을 `timeoutMs * (multiplier ^ attempts)`
   * 로 늘려 KIS 토큰/네트워크 일시 실패 시 hammering 을 막는다.
   * - default 1 (백오프 없음, BC 보존)
   * - 권장 3 (10s → 30s → 90s → ...)
   */
  backoffMultiplier?: number;
  /** 백오프 cap — multiplier^attempts 가 이 값을 넘지 않도록 clamp. default 9. */
  backoffMaxFactor?: number;
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
 * NM-017 보강:
 * - reorderMode 옵션으로 취소 후 재주문 동작 제어.
 * - onReorder 콜백이 새 odno를 반환하면 자동으로 rearm (다음 사이클 감시).
 * - maxRetries 도달 시 재주문 불가 + onLimitReached 호출.
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
   * NM-017: 재주문 후 새 odno로 reg를 업데이트하고 싶을 때 newOdno를 전달.
   */
  rearm(key: PendingOrderKey, newOdno?: string): void {
    const id = keyId(key);
    const entry = this.entries.get(id);
    if (!entry || entry.disposed) return;
    if (newOdno !== undefined) {
      entry.reg = { ...entry.reg, odno: newOdno };
    }
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

  /** 현재 감시 중인 등록 목록 (읽기 전용 스냅샷). */
  listActive(): ReadonlyArray<PendingOrderRegistration & { attempts: number }> {
    return Array.from(this.entries.values()).map((e) => ({ ...e.reg, attempts: e.attempts }));
  }

  private arm(entry: Entry): void {
    entry.handle?.clear();
    const multiplier = this.opts.backoffMultiplier ?? 1;
    const maxFactor = this.opts.backoffMaxFactor ?? 9;
    // 첫 발사: attempts=0 → factor=1, 두번째 rearm: attempts=1 → factor=multiplier, ...
    const rawFactor = multiplier <= 1 ? 1 : multiplier ** entry.attempts;
    const factor = Math.min(rawFactor, maxFactor);
    const delayMs = Math.max(1, Math.floor(this.opts.timeoutMs * factor));
    entry.handle = this.opts.timer.setTimeout(() => {
      if (entry.disposed) return;
      entry.attempts += 1;
      const attempt = entry.attempts;
      this.opts.onExpire(entry.reg, attempt);

      const reorderMode = this.opts.reorderMode ?? 'NONE';

      if (this.opts.maxRetries !== null && attempt >= this.opts.maxRetries) {
        // 횟수 한도 도달 — 재주문 없이 종료
        this.opts.onLimitReached(entry.reg);
        this.cancel(entry.reg);
        return;
      }

      // NM-017: 재주문 모드 처리
      if (reorderMode !== 'NONE' && this.opts.onReorder) {
        const onReorder = this.opts.onReorder;
        void onReorder(entry.reg, reorderMode, attempt).then((newOdno) => {
          if (entry.disposed) return;
          if (newOdno) {
            // 재주문 성공 — 새 odno로 rearm
            this.rearm(entry.reg, newOdno);
          }
          // 재주문 실패(null) 이면 감시 종료
        });
      }
      // NONE 모드이면 caller가 직접 rearm() 호출 (기존 동작 유지)
    }, delayMs);
  }
}

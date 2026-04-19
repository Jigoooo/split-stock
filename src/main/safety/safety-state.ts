import type { EventLogger } from '../logging/event-logger';

/**
 * 안전 3계층 상태.
 * - master: 전체 자동매매 ON/OFF (킬 스위치 대상)
 * - bySymbol: 종목별 ON/OFF (세밀 제어)
 * - errorLock: 에러 발생 시 자동 잠금 (증거금 부족 등), 해제는 수동만 가능
 */
export interface SafetySnapshot {
  master: boolean;
  bySymbol: Record<string, boolean>;
  errorLock: { active: boolean; reason: string | null; triggeredAt: number | null };
  updatedAt: number;
}

export interface SafetyState {
  getSnapshot(): SafetySnapshot;
  setMaster(on: boolean): SafetySnapshot;
  toggleSymbol(pdno: string, on: boolean): SafetySnapshot;
  triggerKillSwitch(reason: string): SafetySnapshot;
  recordError(reason: string): SafetySnapshot;
  clearErrorLock(): SafetySnapshot;
  /** 실거래 여부 판정 — master AND (종목별 ON 또는 지정 안 됨) AND errorLock 비활성. */
  canTrade(pdno: string): boolean;
  subscribe(listener: (snap: SafetySnapshot) => void): () => void;
}

export interface CreateSafetyStateOptions {
  logger: EventLogger;
  now?: () => number;
  /** 초기 상태 — 앱 재시작 후 설정 복원용. */
  initial?: Partial<Pick<SafetySnapshot, 'master' | 'bySymbol'>>;
  /** 로그 메시지에 포함할 계좌 식별자 (registry 사용 시 자동 주입). */
  accountId?: number;
}

export function createSafetyState(opts: CreateSafetyStateOptions): SafetyState {
  const now = opts.now ?? (() => Date.now());
  const accountId = opts.accountId ?? null;
  let snapshot: SafetySnapshot = {
    master: opts.initial?.master ?? false,
    bySymbol: { ...(opts.initial?.bySymbol ?? {}) },
    errorLock: { active: false, reason: null, triggeredAt: null },
    updatedAt: now(),
  };
  const listeners = new Set<(snap: SafetySnapshot) => void>();

  const emit = (): SafetySnapshot => {
    snapshot = { ...snapshot, updatedAt: now() };
    for (const l of Array.from(listeners)) l(snapshot);
    return snapshot;
  };

  const logPayload = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    return accountId !== null ? { accountId, ...extra } : extra;
  };

  return {
    getSnapshot: () => snapshot,

    setMaster(on) {
      if (snapshot.master === on) return snapshot;
      snapshot = { ...snapshot, master: on };
      opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: `safety.master.${on ? 'on' : 'off'}`,
        payload: logPayload(),
      });
      return emit();
    },

    toggleSymbol(pdno, on) {
      snapshot = {
        ...snapshot,
        bySymbol: { ...snapshot.bySymbol, [pdno]: on },
      };
      opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: `safety.symbol.${on ? 'on' : 'off'}`,
        payload: logPayload({ pdno }),
      });
      return emit();
    },

    triggerKillSwitch(reason) {
      snapshot = {
        ...snapshot,
        master: false,
        errorLock: { active: true, reason, triggeredAt: now() },
      };
      opts.logger.log({
        level: 'ERROR',
        category: 'SYS',
        message: 'safety.kill_switch.triggered',
        payload: logPayload({ reason }),
      });
      return emit();
    },

    recordError(reason) {
      snapshot = {
        ...snapshot,
        master: false,
        errorLock: { active: true, reason, triggeredAt: now() },
      };
      opts.logger.log({
        level: 'ERROR',
        category: 'SYS',
        message: 'safety.error_lock.engaged',
        payload: logPayload({ reason }),
      });
      return emit();
    },

    clearErrorLock() {
      if (!snapshot.errorLock.active) return snapshot;
      snapshot = {
        ...snapshot,
        errorLock: { active: false, reason: null, triggeredAt: null },
      };
      opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'safety.error_lock.cleared',
        payload: logPayload(),
      });
      return emit();
    },

    canTrade(pdno) {
      if (snapshot.errorLock.active) return false;
      if (!snapshot.master) return false;
      const perSymbol = snapshot.bySymbol[pdno];
      // 미지정은 허용 (기본값) — 명시적으로 false로 꺼둘 수 있음
      return perSymbol !== false;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface SafetyRegistryListenerEvent {
  accountId: number;
  snapshot: SafetySnapshot;
}

/**
 * 다계좌 안전 상태 격리 — `Map<accountId, SafetyState>`.
 *
 * 보안 불변식:
 * - 계좌 A의 setMaster(true) 가 계좌 B의 master 에 영향을 주지 않음.
 * - 계좌 A의 toggleSymbol/errorLock/triggerKillSwitch 도 마찬가지로 계좌별 격리.
 * - subscribe 콜백은 (accountId, snapshot) 페이로드로 호출되어 어느 계좌 변경인지 식별 가능.
 *
 * 호출 패턴:
 *   const safety = registry.get(accountId);
 *   if (!safety.canTrade(pdno)) { ... }
 */
export class SafetyStateRegistry {
  private readonly states = new Map<number, SafetyState>();
  private readonly listeners = new Set<(e: SafetyRegistryListenerEvent) => void>();
  private readonly innerUnsubscribers = new Map<number, () => void>();

  constructor(
    private readonly opts: {
      logger: EventLogger;
      now?: () => number;
    },
  ) {}

  /**
   * 해당 계좌의 SafetyState — 없으면 lazy 생성.
   */
  get(accountId: number): SafetyState {
    let state = this.states.get(accountId);
    if (state) return state;
    state = createSafetyState({
      logger: this.opts.logger,
      ...(this.opts.now ? { now: this.opts.now } : {}),
      accountId,
    });
    this.states.set(accountId, state);
    // inner state 변화를 registry 레벨로 fan-out.
    const unsub = state.subscribe((snapshot) => {
      for (const l of Array.from(this.listeners)) l({ accountId, snapshot });
    });
    this.innerUnsubscribers.set(accountId, unsub);
    return state;
  }

  /**
   * 모든 계좌에 동시에 킬 스위치 — 글로벌 단축키 등에서 호출.
   * 등록되지 않은 계좌는 영향 없음 (lazy 생성도 안 함).
   */
  triggerKillSwitchAll(reason: string): void {
    for (const state of this.states.values()) {
      state.triggerKillSwitch(reason);
    }
  }

  /**
   * 등록된 계좌 ID 목록.
   */
  accountIds(): number[] {
    return Array.from(this.states.keys());
  }

  /**
   * 모든 계좌 상태 변화 구독 — (accountId, snapshot) 페이로드.
   */
  subscribe(listener: (e: SafetyRegistryListenerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 테스트/리셋 용 — 내부 상태 청소.
   */
  clear(): void {
    for (const unsub of this.innerUnsubscribers.values()) unsub();
    this.innerUnsubscribers.clear();
    this.states.clear();
    this.listeners.clear();
  }
}

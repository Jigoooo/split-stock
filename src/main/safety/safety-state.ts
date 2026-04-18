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
}

export function createSafetyState(opts: CreateSafetyStateOptions): SafetyState {
  const now = opts.now ?? (() => Date.now());
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

  return {
    getSnapshot: () => snapshot,

    setMaster(on) {
      if (snapshot.master === on) return snapshot;
      snapshot = { ...snapshot, master: on };
      opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: `safety.master.${on ? 'on' : 'off'}`,
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
        payload: { pdno },
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
        payload: { reason },
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
        payload: { reason },
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

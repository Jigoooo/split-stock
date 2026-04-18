import { describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { createSafetyState } from './safety-state';

function noopLogger(): EventLogger & { entries: Array<{ message: string }> } {
  const entries: Array<{ message: string }> = [];
  return {
    entries,
    log: (e) => {
      entries.push({ message: e.message });
    },
  };
}

describe('SafetyState', () => {
  it('초기 상태는 master=off, errorLock=inactive', () => {
    const s = createSafetyState({ logger: noopLogger() });
    const snap = s.getSnapshot();
    expect(snap.master).toBe(false);
    expect(snap.errorLock.active).toBe(false);
  });

  it('setMaster(true) → master ON, canTrade=true (특정 종목 전무 시)', () => {
    const s = createSafetyState({ logger: noopLogger() });
    s.setMaster(true);
    expect(s.getSnapshot().master).toBe(true);
    expect(s.canTrade('005930')).toBe(true);
  });

  it('toggleSymbol(pdno, false) → 해당 종목 거래 금지', () => {
    const s = createSafetyState({ logger: noopLogger() });
    s.setMaster(true);
    s.toggleSymbol('005930', false);
    expect(s.canTrade('005930')).toBe(false);
    expect(s.canTrade('000660')).toBe(true);
  });

  it('recordError → errorLock 활성 + master OFF 자동', () => {
    const logger = noopLogger();
    const s = createSafetyState({ logger });
    s.setMaster(true);
    s.recordError('증거금 부족');
    const snap = s.getSnapshot();
    expect(snap.master).toBe(false);
    expect(snap.errorLock.active).toBe(true);
    expect(snap.errorLock.reason).toBe('증거금 부족');
    expect(s.canTrade('005930')).toBe(false);
    expect(logger.entries.some((e) => e.message === 'safety.error_lock.engaged')).toBe(true);
  });

  it('clearErrorLock 후 master를 다시 켜야 거래 가능', () => {
    const s = createSafetyState({ logger: noopLogger() });
    s.setMaster(true);
    s.recordError('일시 오류');
    s.clearErrorLock();
    expect(s.canTrade('005930')).toBe(false); // master는 아직 off
    s.setMaster(true);
    expect(s.canTrade('005930')).toBe(true);
  });

  it('triggerKillSwitch → 즉시 master OFF + errorLock 활성', () => {
    const s = createSafetyState({ logger: noopLogger() });
    s.setMaster(true);
    s.triggerKillSwitch('사용자 단축키');
    const snap = s.getSnapshot();
    expect(snap.master).toBe(false);
    expect(snap.errorLock.active).toBe(true);
    expect(snap.errorLock.reason).toBe('사용자 단축키');
  });

  it('subscribe → 상태 변화 시 콜백 호출', () => {
    const s = createSafetyState({ logger: noopLogger() });
    const events: boolean[] = [];
    const unsub = s.subscribe((snap) => events.push(snap.master));
    s.setMaster(true);
    s.setMaster(false);
    unsub();
    s.setMaster(true);
    expect(events).toEqual([true, false]);
  });

  it('canTrade: 종목별 true 지정 + master off → false', () => {
    const s = createSafetyState({ logger: noopLogger() });
    s.toggleSymbol('005930', true);
    expect(s.canTrade('005930')).toBe(false);
  });
});

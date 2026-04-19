import { describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { createSafetyState, SafetyStateRegistry } from './safety-state';

function noopLogger(): EventLogger & {
  entries: Array<{ message: string; payload?: unknown }>;
} {
  const entries: Array<{ message: string; payload?: unknown }> = [];
  return {
    entries,
    log: (e) => {
      entries.push({ message: e.message, payload: e.payload });
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

describe('SafetyStateRegistry — per-account 격리', () => {
  it('계좌 A의 master 변경이 계좌 B에 영향 없음', () => {
    const logger = noopLogger();
    const reg = new SafetyStateRegistry({ logger });
    const a = reg.get(1);
    const b = reg.get(2);

    a.setMaster(true);
    expect(a.getSnapshot().master).toBe(true);
    expect(b.getSnapshot().master).toBe(false);

    b.setMaster(true);
    a.setMaster(false);
    expect(a.getSnapshot().master).toBe(false);
    expect(b.getSnapshot().master).toBe(true);
  });

  it('계좌 A의 toggleSymbol/canTrade 가 계좌 B 와 독립', () => {
    const reg = new SafetyStateRegistry({ logger: noopLogger() });
    const a = reg.get(1);
    const b = reg.get(2);
    a.setMaster(true);
    b.setMaster(true);

    a.toggleSymbol('005930', false);
    expect(a.canTrade('005930')).toBe(false);
    expect(b.canTrade('005930')).toBe(true); // B는 영향 없음
  });

  it('계좌 A의 errorLock 이 계좌 B의 거래 차단하지 않음', () => {
    const reg = new SafetyStateRegistry({ logger: noopLogger() });
    const a = reg.get(1);
    const b = reg.get(2);
    a.setMaster(true);
    b.setMaster(true);

    a.recordError('A 계좌 증거금 부족');
    expect(a.canTrade('005930')).toBe(false);
    expect(a.getSnapshot().errorLock.active).toBe(true);
    expect(b.canTrade('005930')).toBe(true);
    expect(b.getSnapshot().errorLock.active).toBe(false);
  });

  it('triggerKillSwitchAll — 등록된 모든 계좌의 master OFF', () => {
    const reg = new SafetyStateRegistry({ logger: noopLogger() });
    const a = reg.get(1);
    const b = reg.get(2);
    a.setMaster(true);
    b.setMaster(true);

    reg.triggerKillSwitchAll('글로벌 단축키');
    expect(a.getSnapshot().master).toBe(false);
    expect(a.getSnapshot().errorLock.active).toBe(true);
    expect(b.getSnapshot().master).toBe(false);
    expect(b.getSnapshot().errorLock.active).toBe(true);
  });

  it('subscribe — (accountId, snapshot) 페이로드로 fan-out', () => {
    const reg = new SafetyStateRegistry({ logger: noopLogger() });
    const a = reg.get(1);
    const b = reg.get(2);
    const events: Array<{ accountId: number; master: boolean }> = [];
    reg.subscribe((e) => events.push({ accountId: e.accountId, master: e.snapshot.master }));

    a.setMaster(true);
    b.setMaster(true);
    a.setMaster(false);

    expect(events).toEqual([
      { accountId: 1, master: true },
      { accountId: 2, master: true },
      { accountId: 1, master: false },
    ]);
  });

  it('get(id) 는 동일 계좌에 대해 같은 인스턴스 반환', () => {
    const reg = new SafetyStateRegistry({ logger: noopLogger() });
    const a1 = reg.get(1);
    const a2 = reg.get(1);
    expect(a1).toBe(a2);
  });

  it('logger payload 에 accountId 포함', () => {
    const logger = noopLogger();
    const reg = new SafetyStateRegistry({ logger });
    reg.get(7).setMaster(true);
    const masterOn = logger.entries.find((e) => e.message === 'safety.master.on');
    expect(masterOn).toBeDefined();
    expect(masterOn?.payload).toMatchObject({ accountId: 7 });
  });
});

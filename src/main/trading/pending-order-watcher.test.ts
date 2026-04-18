import { describe, expect, it } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { type PendingOrderRegistration, PendingOrderWatcher } from './pending-order-watcher';

function mkReg(overrides: Partial<PendingOrderRegistration> = {}): PendingOrderRegistration {
  return {
    pdno: '005930',
    side: 'BUY',
    nth: 1,
    odno: 'ODNO001',
    ...overrides,
  };
}

describe('PendingOrderWatcher', () => {
  it('타임아웃 만료 시 onExpire 호출 (attempt=1)', () => {
    const timer = new FakeTimer();
    const expires: Array<{ odno: string; attempt: number }> = [];
    const limitReached: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 60_000,
      maxRetries: 3,
      onExpire: (e, attempt) => expires.push({ odno: e.odno, attempt }),
      onLimitReached: (e) => limitReached.push(e.odno),
    });
    w.register(mkReg());
    expect(w.size()).toBe(1);

    timer.advance(30_000);
    expect(expires).toHaveLength(0); // 아직 미만료

    timer.advance(30_000); // 총 60s 도달
    expect(expires).toEqual([{ odno: 'ODNO001', attempt: 1 }]);
    expect(limitReached).toEqual([]); // 재시도 초과 아님
  });

  it('cancel(key) → 타이머 해제 + 이후 만료 없음', () => {
    const timer = new FakeTimer();
    const expires: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 10_000,
      maxRetries: null,
      onExpire: (e) => expires.push(e.odno),
      onLimitReached: () => {},
    });
    w.register(mkReg());
    w.cancel({ pdno: '005930', side: 'BUY', nth: 1 });
    expect(w.size()).toBe(0);

    timer.advance(20_000);
    expect(expires).toEqual([]);
  });

  it('중복 register(같은 키) → 두 번째는 noop (타이머 유지)', () => {
    const timer = new FakeTimer();
    const expires: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 10_000,
      maxRetries: null,
      onExpire: (e) => expires.push(e.odno),
      onLimitReached: () => {},
    });
    w.register(mkReg({ odno: 'FIRST' }));
    w.register(mkReg({ odno: 'DUP' })); // 같은 키, 다른 odno
    expect(w.size()).toBe(1);

    timer.advance(10_000);
    // 첫 등록의 reg가 유지됨 → FIRST가 콜백으로 옴
    expect(expires).toEqual(['FIRST']);
  });

  it('재시도 초과 시 onLimitReached 호출 후 해제', () => {
    const timer = new FakeTimer();
    const expires: number[] = [];
    const limits: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: 2,
      onExpire: (_, attempt) => {
        expires.push(attempt);
        // 호출측이 재주문 후 rearm을 흉내
        w.rearm({ pdno: '005930', side: 'BUY', nth: 1 });
      },
      onLimitReached: (e) => limits.push(e.odno),
    });
    w.register(mkReg());

    timer.advance(5_000); // attempt 1
    timer.advance(5_000); // attempt 2 → maxRetries 도달

    expect(expires).toEqual([1, 2]);
    expect(limits).toEqual(['ODNO001']);
    expect(w.size()).toBe(0); // 자동 해제
  });

  it('dispose() → 모든 타이머 해제, 이후 만료 안 됨', () => {
    const timer = new FakeTimer();
    const expires: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 10_000,
      maxRetries: null,
      onExpire: (e) => expires.push(e.odno),
      onLimitReached: () => {},
    });
    w.register(mkReg({ nth: 1 }));
    w.register(mkReg({ nth: 2 }));
    expect(w.size()).toBe(2);

    w.dispose();
    expect(w.size()).toBe(0);

    timer.advance(20_000);
    expect(expires).toEqual([]);
  });

  it('rearm(key) → 타이머 재무장, attempts는 유지', () => {
    const timer = new FakeTimer();
    const expires: number[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 10_000,
      maxRetries: 5,
      onExpire: (_, attempt) => expires.push(attempt),
      onLimitReached: () => {},
    });
    w.register(mkReg());

    timer.advance(10_000); // attempt 1
    expect(expires).toEqual([1]);

    // 호출측이 재주문 후 rearm
    w.rearm({ pdno: '005930', side: 'BUY', nth: 1 });
    timer.advance(10_000); // attempt 2
    expect(expires).toEqual([1, 2]);
  });
});

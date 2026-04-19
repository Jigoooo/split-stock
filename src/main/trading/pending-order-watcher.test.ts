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

  // ────────────────────────────────────────────
  //  NM-017: reorderMode 시나리오
  // ────────────────────────────────────────────

  it('reorderMode=NONE → onReorder 미호출, rearm 미수행', async () => {
    const timer = new FakeTimer();
    const expires: number[] = [];
    const reorders: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: null,
      reorderMode: 'NONE',
      onExpire: (_, attempt) => expires.push(attempt),
      onLimitReached: () => {},
      onReorder: async () => {
        reorders.push('called');
        return 'NEW_ODNO';
      },
    });
    w.register(mkReg());
    timer.advance(5_000); // attempt 1

    // 마이크로태스크 소비
    await Promise.resolve();

    expect(expires).toEqual([1]);
    expect(reorders).toEqual([]); // NONE → onReorder 미호출
    // rearm 없으면 size는 1 유지 (entry 살아있음, arm만 안 됨)
    expect(w.size()).toBe(1);
  });

  it('reorderMode=MARKET → onExpire 후 onReorder 호출, 새 odno로 rearm', async () => {
    const timer = new FakeTimer();
    const expires: Array<{ odno: string; attempt: number }> = [];
    const reorders: Array<{ odno: string; mode: string; attempt: number }> = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: null,
      reorderMode: 'MARKET',
      onExpire: (e, attempt) => expires.push({ odno: e.odno, attempt }),
      onLimitReached: () => {},
      onReorder: async (entry, mode, attempt) => {
        reorders.push({ odno: entry.odno, mode, attempt });
        return 'NEW_ODNO_001';
      },
    });
    w.register(mkReg({ odno: 'ORIG_ODNO' }));
    timer.advance(5_000); // attempt 1

    await Promise.resolve();

    expect(expires).toEqual([{ odno: 'ORIG_ODNO', attempt: 1 }]);
    expect(reorders).toEqual([{ odno: 'ORIG_ODNO', mode: 'MARKET', attempt: 1 }]);

    // 재주문 성공 → 새 odno로 rearm, size 유지
    expect(w.size()).toBe(1);
    const actives = w.listActive();
    expect(actives[0]?.odno).toBe('NEW_ODNO_001');
  });

  it('reorderMode=LIMIT_AT_LAST_PRICE → onReorder에 올바른 mode 전달', async () => {
    const timer = new FakeTimer();
    const capturedModes: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: null,
      reorderMode: 'LIMIT_AT_LAST_PRICE',
      onExpire: () => {},
      onLimitReached: () => {},
      onReorder: async (_, mode) => {
        capturedModes.push(mode);
        return 'NEW_ODNO_LIMIT';
      },
    });
    w.register(mkReg());
    timer.advance(5_000);

    await Promise.resolve();

    expect(capturedModes).toEqual(['LIMIT_AT_LAST_PRICE']);
  });

  it('maxRetries 도달 시 재주문 없이 onLimitReached 후 해제', async () => {
    const timer = new FakeTimer();
    const limits: string[] = [];
    const reorders: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: 2,
      reorderMode: 'MARKET',
      onExpire: () => {},
      onLimitReached: (e) => limits.push(e.odno),
      onReorder: async () => {
        reorders.push('called');
        return 'NEW_ODNO';
      },
    });
    w.register(mkReg({ odno: 'ORIG' }));

    // attempt 1 (maxRetries=2 미만)
    timer.advance(5_000);
    await Promise.resolve();
    expect(w.size()).toBe(1);
    expect(reorders).toHaveLength(1); // 재주문 호출됨

    // attempt 2 (maxRetries 도달)
    timer.advance(5_000);
    await Promise.resolve();

    // attempt 1에서 재주문 성공 → odno가 NEW_ODNO로 갱신됨
    // attempt 2에서 onLimitReached가 호출될 때 reg.odno는 NEW_ODNO
    expect(limits).toEqual(['NEW_ODNO']); // onLimitReached 호출
    expect(w.size()).toBe(0); // 감시 해제
    // maxRetries 도달 시 onReorder 미호출 (2회째에선 호출 안 됨)
    expect(reorders).toHaveLength(1); // 1회만
  });

  it('onReorder가 null 반환 → rearm 스킵, 감시 종료', async () => {
    const timer = new FakeTimer();
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 5_000,
      maxRetries: null,
      reorderMode: 'MARKET',
      onExpire: () => {},
      onLimitReached: () => {},
      onReorder: async () => null, // 재주문 실패
    });
    w.register(mkReg());
    timer.advance(5_000);
    await Promise.resolve();

    // rearm 안 됨 → entry는 남아있으나 timer 없음
    expect(w.size()).toBe(1); // entry 존재 (disposed=false)
    // 새 watcher로 확인할 수 없으므로 listActive로 odno 확인
    const actives = w.listActive();
    expect(actives[0]?.odno).toBe('ODNO001');
  });

  it('listActive() → 현재 감시 중 목록 반환', () => {
    const timer = new FakeTimer();
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 60_000,
      maxRetries: null,
      onExpire: () => {},
      onLimitReached: () => {},
    });
    w.register(mkReg({ pdno: '005930', nth: 1, odno: 'O1' }));
    w.register(mkReg({ pdno: '005930', nth: 2, odno: 'O2' }));
    w.register(mkReg({ pdno: '000660', nth: 1, odno: 'O3' }));

    const list = w.listActive();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.odno).sort()).toEqual(['O1', 'O2', 'O3']);
  });

  it('rearm(key, newOdno) → odno 업데이트 후 타이머 재무장', () => {
    const timer = new FakeTimer();
    const expires: string[] = [];
    const w = new PendingOrderWatcher({
      timer,
      timeoutMs: 10_000,
      maxRetries: null,
      onExpire: (e) => expires.push(e.odno),
      onLimitReached: () => {},
    });
    w.register(mkReg({ odno: 'ORIG' }));
    timer.advance(10_000); // attempt 1 → ORIG 만료

    w.rearm({ pdno: '005930', side: 'BUY', nth: 1 }, 'NEW_ODNO');
    timer.advance(10_000); // attempt 2 → NEW_ODNO 만료

    expect(expires).toEqual(['ORIG', 'NEW_ODNO']);
  });
});

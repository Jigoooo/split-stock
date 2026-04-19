import { describe, expect, it } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { type BoosterTask, BoosterWatcher } from './booster-watcher';

const baseTask = (overrides: Partial<BoosterTask> = {}): BoosterTask => ({
  pdno: '005930',
  lastFilledPrice: 70_000,
  boosterPct: 0.02,
  amountKrw: 1_000_000,
  ...overrides,
});

describe('BoosterWatcher', () => {
  it('boosterPct > 0: 임계가 이하 도달 시 onTrigger', () => {
    const triggers: Array<{ pdno: string; price: number }> = [];
    const w = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (t, ctx) => triggers.push({ pdno: t.pdno, price: ctx.price }),
    });
    w.register(baseTask({ boosterPct: 0.02 })); // 70000*0.98 = 68600
    w.onPrice('005930', 69_000);
    expect(triggers).toEqual([]); // 아직
    w.onPrice('005930', 68_500);
    expect(triggers).toEqual([{ pdno: '005930', price: 68_500 }]);
    expect(w.size()).toBe(0); // 트리거 후 자동 해제
  });

  it('boosterPct <= 0: register 즉시 트리거', () => {
    const triggers: number[] = [];
    const w = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (_, ctx) => triggers.push(ctx.price),
    });
    w.register(baseTask({ boosterPct: 0 }));
    expect(triggers).toEqual([70_000]);

    const w2 = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (_, ctx) => triggers.push(ctx.price),
    });
    w2.register(baseTask({ boosterPct: -0.01 }));
    expect(triggers).toEqual([70_000, 70_000]);
  });

  it('expiresAt 경과 시 onExpire + 감시 해제', () => {
    const timer = new FakeTimer();
    const triggers: string[] = [];
    const expires: string[] = [];
    const w = new BoosterWatcher({
      timer,
      onTrigger: (t) => triggers.push(t.pdno),
      onExpire: (t) => expires.push(t.pdno),
    });
    w.register(baseTask({ expiresAt: 60_000 }));

    timer.advance(60_000);
    expect(expires).toEqual(['005930']);
    expect(triggers).toEqual([]);
    expect(w.size()).toBe(0);

    // 만료 이후 가격 도달해도 onTrigger 호출 안 함
    w.onPrice('005930', 50_000);
    expect(triggers).toEqual([]);
  });

  it('미도달 시 트리거 없음 (가격 유지)', () => {
    const triggers: string[] = [];
    const w = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (t) => triggers.push(t.pdno),
    });
    w.register(baseTask({ boosterPct: 0.05 })); // 임계 66500
    w.onPrice('005930', 69_000);
    w.onPrice('005930', 67_000);
    expect(triggers).toEqual([]);
    expect(w.size()).toBe(1);
  });

  it('cancel → 이후 가격 도달해도 onTrigger 없음', () => {
    const triggers: string[] = [];
    const w = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (t) => triggers.push(t.pdno),
    });
    w.register(baseTask());
    w.cancel('005930');
    w.onPrice('005930', 10_000);
    expect(triggers).toEqual([]);
  });

  it('strategySnapshot: register 시점 보존 → onTrigger context로 복원 (Wave 1 verifier H1)', () => {
    const triggers: Array<{ pdno: string; snapshot: unknown }> = [];
    const w = new BoosterWatcher({
      timer: new FakeTimer(),
      onTrigger: (t, ctx) => triggers.push({ pdno: t.pdno, snapshot: ctx.strategySnapshot }),
    });
    const snapshot = {
      lots: [{ nth: 1, qty: 10, price: 70_000 }],
      buyDropPct: 0.025,
      sellGainPct: 0.03,
    };
    w.register(baseTask({ boosterPct: 0.02, strategySnapshot: snapshot }));
    w.onPrice('005930', 68_500); // threshold = 68_600 → 트리거
    expect(triggers).toEqual([{ pdno: '005930', snapshot }]);
  });

  it('register 재호출은 새 task로 교체 (expiresAt 갱신)', () => {
    const timer = new FakeTimer();
    const triggers: string[] = [];
    const w = new BoosterWatcher({
      timer,
      onTrigger: (t) => triggers.push(t.pdno),
    });
    w.register(baseTask({ expiresAt: 1000 }));
    w.register(baseTask({ expiresAt: 10_000 })); // 새 task

    timer.advance(1500); // 이전 expiresAt 지났지만 새 task는 유지
    w.onPrice('005930', 60_000);
    expect(triggers).toEqual(['005930']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { type BoosterTask, type BoosterTriggerContext, BoosterWatcher } from './booster-watcher';

function makeWatcher(opts?: {
  onTrigger?: (task: BoosterTask, ctx: BoosterTriggerContext) => unknown | Promise<unknown>;
  onExpire?: (task: BoosterTask) => void;
  timer?: FakeTimer;
}): { watcher: BoosterWatcher; timer: FakeTimer; trigger: ReturnType<typeof vi.fn> } {
  const timer = opts?.timer ?? new FakeTimer();
  const trigger = vi.fn(opts?.onTrigger ?? (() => undefined));
  const watcher = new BoosterWatcher(
    opts?.onExpire
      ? { timer, onTrigger: trigger, onExpire: opts.onExpire }
      : { timer, onTrigger: trigger },
  );
  return { watcher, timer, trigger };
}

const baseTask: BoosterTask = {
  pdno: '005930',
  accountId: 1,
  lastFilledPrice: 70_000,
  boosterPct: 0.01,
  amountKrw: 1_000_000,
};

describe('BoosterWatcher', () => {
  it('lastFilledPrice * (1 - boosterPct) 도달 시 onTrigger 를 호출한다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register(baseTask);

    watcher.onPrice(1, '005930', 70_000); // 미달 (= lastFilledPrice)
    expect(trigger).not.toHaveBeenCalled();

    watcher.onPrice(1, '005930', 69_300); // threshold = 69300
    expect(trigger).toHaveBeenCalledTimes(1);
    const firstCall = trigger.mock.calls[0];
    if (!firstCall) throw new Error('trigger not called');
    const [task, ctx] = firstCall;
    expect(task).toEqual(baseTask);
    expect(ctx.price).toBe(69_300);
  });

  it('boosterPct <= 0 이면 register 즉시 트리거한다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register({ ...baseTask, boosterPct: 0 });
    expect(trigger).toHaveBeenCalledTimes(1);
    const call = trigger.mock.calls[0];
    if (!call) throw new Error('trigger not called');
    expect(call[1].price).toBe(70_000);
  });

  it('한 번 트리거된 task 는 중복 트리거되지 않는다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register(baseTask);
    watcher.onPrice(1, '005930', 69_000);
    watcher.onPrice(1, '005930', 68_000);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('서로 다른 (accountId, pdno) 키는 독립적으로 관리된다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register({ ...baseTask, accountId: 1 });
    watcher.register({ ...baseTask, accountId: 2 });

    watcher.onPrice(1, '005930', 69_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    const call = trigger.mock.calls[0];
    if (!call) throw new Error('trigger not called');
    expect(call[0].accountId).toBe(1);
    expect(watcher.has(2, '005930')).toBe(true);
  });

  it('cancel 후에는 onPrice 가 트리거하지 않는다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register(baseTask);
    watcher.cancel(1, '005930');
    watcher.onPrice(1, '005930', 60_000);
    expect(trigger).not.toHaveBeenCalled();
    expect(watcher.has(1, '005930')).toBe(false);
  });

  it('expiresAt 도달 시 onExpire 를 호출하고 task 가 해제된다', () => {
    const onExpire = vi.fn();
    const { watcher, timer, trigger } = makeWatcher({ onExpire });
    watcher.register({ ...baseTask, expiresAt: 5_000 });

    timer.advance(4_999);
    expect(onExpire).not.toHaveBeenCalled();

    timer.advance(2);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(watcher.has(1, '005930')).toBe(false);

    watcher.onPrice(1, '005930', 60_000);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('이미 트리거된 task 는 expiresAt 도달해도 onExpire 를 호출하지 않는다', () => {
    const onExpire = vi.fn();
    const { watcher, timer } = makeWatcher({ onExpire });
    watcher.register({ ...baseTask, expiresAt: 10_000 });
    watcher.onPrice(1, '005930', 69_000);

    timer.advance(20_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('동일 키로 register 호출 시 기존 task 를 교체하고 만료 타이머를 재설정한다', () => {
    const onExpire = vi.fn();
    const { watcher, timer, trigger } = makeWatcher({ onExpire });
    watcher.register({ ...baseTask, expiresAt: 5_000 });
    watcher.register({
      ...baseTask,
      lastFilledPrice: 80_000,
      expiresAt: 15_000,
    });

    timer.advance(6_000); // 첫 task 의 expire 시점 — 무시되어야 함
    expect(onExpire).not.toHaveBeenCalled();

    watcher.onPrice(1, '005930', 79_300); // new threshold = 80000 * 0.99 = 79200, 79_300 미달
    expect(trigger).not.toHaveBeenCalled();

    watcher.onPrice(1, '005930', 79_200); // 정확히 도달
    expect(trigger).toHaveBeenCalledTimes(1);
    const call = trigger.mock.calls[0];
    if (!call) throw new Error('trigger not called');
    expect(call[0].lastFilledPrice).toBe(80_000);
  });

  it('list / size 는 active task 만 노출한다', () => {
    const { watcher } = makeWatcher();
    watcher.register({ ...baseTask, accountId: 1 });
    watcher.register({ ...baseTask, accountId: 2, pdno: '000660' });
    expect(watcher.size()).toBe(2);
    expect(watcher.list()).toHaveLength(2);

    watcher.cancel(1, '005930');
    expect(watcher.size()).toBe(1);
    const [remaining] = watcher.list();
    if (!remaining) throw new Error('list empty');
    expect(remaining.accountId).toBe(2);
  });

  it('dispose 는 모든 task 를 해제한다', () => {
    const { watcher, trigger } = makeWatcher();
    watcher.register({ ...baseTask, accountId: 1 });
    watcher.register({ ...baseTask, accountId: 2 });
    watcher.dispose();
    expect(watcher.size()).toBe(0);

    watcher.onPrice(1, '005930', 60_000);
    watcher.onPrice(2, '005930', 60_000);
    expect(trigger).not.toHaveBeenCalled();
  });
});

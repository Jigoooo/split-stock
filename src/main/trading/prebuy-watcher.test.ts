import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { FakeTimer } from '../testing/fake-timer';
import { PrebuyRepo } from './prebuy-repo';
import { PrebuyWatcher } from './prebuy-watcher';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new PrebuyRepo(db);
}

describe('PrebuyWatcher', () => {
  it('reload → listPending을 내부 맵으로 로드', () => {
    const repo = setup();
    repo.insert({
      accountId: 1,
      pdno: '005930',
      targetPrice: 60_000,
      amountKrw: 1_000_000,
      validUntil: new Date('2030-01-01'),
    });
    const w = new PrebuyWatcher({
      timer: new FakeTimer(),
      repo,
      onTrigger: () => {},
    });
    w.reload();
    expect(w.size()).toBe(1);
  });

  it('targetPrice 도달 시 onTrigger + 중복 트리거 방지', () => {
    const repo = setup();
    const ins = repo.insert({
      accountId: 1,
      pdno: '005930',
      targetPrice: 60_000,
      amountKrw: 1_000_000,
      validUntil: new Date('2030-01-01'),
    });
    if (ins.isErr()) throw new Error('seed');
    const triggers: number[] = [];
    const w = new PrebuyWatcher({
      timer: new FakeTimer(),
      repo,
      onTrigger: (o) => triggers.push(o.id),
    });
    w.reload();
    w.onPrice('005930', 60_000); // 경계 = 트리거
    w.onPrice('005930', 59_000); // 재호출 but 이미 제거
    expect(triggers).toEqual([ins.value]);
    expect(w.size()).toBe(0);
  });

  it('validUntil 경과 → markExpired + onExpire', () => {
    const repo = setup();
    const ins = repo.insert({
      accountId: 1,
      pdno: '005930',
      targetPrice: 60_000,
      amountKrw: 1_000_000,
      validUntil: new Date(100_000),
    });
    if (ins.isErr()) throw new Error('seed');
    const timer = new FakeTimer();
    const expires: number[] = [];
    const w = new PrebuyWatcher({
      timer,
      repo,
      onTrigger: () => {},
      onExpire: (o) => expires.push(o.id),
      expiryCheckMs: 10_000,
    });
    w.reload();

    timer.setNow(99_000); // 아직 유효
    timer.advance(10_000); // check 실행 at 109_000 → 만료됨
    expect(expires).toEqual([ins.value]);
    expect(w.size()).toBe(0);

    // DB 상태도 EXPIRED로 변경됨
    expect(repo.listPending()).toHaveLength(0);
  });

  it('미도달 시 트리거 없음 (가격 >= targetPrice)', () => {
    const repo = setup();
    const ins = repo.insert({
      accountId: 1,
      pdno: '005930',
      targetPrice: 60_000,
      amountKrw: 1_000_000,
      validUntil: new Date('2030-01-01'),
    });
    if (ins.isErr()) throw new Error('seed');
    const triggers: number[] = [];
    const w = new PrebuyWatcher({
      timer: new FakeTimer(),
      repo,
      onTrigger: (o) => triggers.push(o.id),
    });
    w.reload();
    w.onPrice('005930', 61_000);
    expect(triggers).toEqual([]);
    expect(w.size()).toBe(1);
  });
});

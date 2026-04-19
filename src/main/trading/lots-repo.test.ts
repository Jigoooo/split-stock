import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { LotsRepo } from './lots-repo';

function setupRepo() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new LotsRepo(db);
}

describe('LotsRepo', () => {
  it('insertLot → snapshot 라운드트립', () => {
    const repo = setupRepo();
    const id = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    expect(id.isOk()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    expect(snap.isOk()).toBe(true);
    if (snap.isOk()) {
      expect(snap.value.lots).toHaveLength(1);
      expect(snap.value.lots[0]).toMatchObject({
        nth: 1,
        buyPrice: 70000,
        qty: 14,
        status: 'OPEN',
      });
    }
  });

  it('중복 (account, pdno, nth) 차수는 rollback — 두 번째 insert 실패', () => {
    const repo = setupRepo();
    const now = new Date();
    const first = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: now,
    });
    expect(first.isOk()).toBe(true);

    const dup = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 67800,
      qty: 14,
      amountKrw: 949_200,
      status: 'OPEN',
      boughtAt: now,
    });
    expect(dup.isErr()).toBe(true);
    if (dup.isErr()) expect(dup.error.kind).toBe('DB_ERROR');

    // rollback 확인: 여전히 1행만 존재 + buyPrice=70000
    const snap = repo.snapshot(1, '005930');
    expect(snap.isOk()).toBe(true);
    if (snap.isOk()) {
      expect(snap.value.lots).toHaveLength(1);
      expect(snap.value.lots[0]?.buyPrice).toBe(70000);
    }
  });

  it('updateLotStatus: OPEN → SELLING → SOLD 전이', () => {
    const repo = setupRepo();
    const inserted = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    if (inserted.isErr()) throw new Error('seed failed');
    const lotId = inserted.value;

    const step1 = repo.updateLotStatus({ lotId, status: 'SELLING' });
    expect(step1.isOk()).toBe(true);

    const step2 = repo.updateLotStatus({
      lotId,
      status: 'SOLD',
      sellPrice: 73500,
      soldAt: new Date(),
    });
    expect(step2.isOk()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap failed');
    expect(snap.value.lots[0]?.status).toBe('SOLD');
  });

  it('updateLotStatus 실패 (없는 lotId) → DB_ERROR, 기존 레코드 변경 없음', () => {
    const repo = setupRepo();
    const inserted = repo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    if (inserted.isErr()) throw new Error('seed failed');

    const missing = repo.updateLotStatus({ lotId: 9999, status: 'SOLD' });
    expect(missing.isErr()).toBe(true);

    const snap = repo.snapshot(1, '005930');
    if (snap.isErr()) throw new Error('snap');
    expect(snap.value.lots[0]?.status).toBe('OPEN');
  });

  describe('per-account 격리 회귀 방지', () => {
    it('계좌 A에 등록한 lot 이 계좌 B snapshot 에 안 나옴', () => {
      const repo = setupRepo();
      const a = repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      const b = repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      expect(a.isOk() && b.isOk()).toBe(true);

      const snapA = repo.snapshot(1, '005930');
      const snapB = repo.snapshot(2, '005930');
      if (snapA.isErr() || snapB.isErr()) throw new Error('snap');

      expect(snapA.value.lots).toHaveLength(1);
      expect(snapA.value.lots[0]?.buyPrice).toBe(70000);
      expect(snapB.value.lots).toHaveLength(1);
      expect(snapB.value.lots[0]?.buyPrice).toBe(60000);
    });

    it('동일 (pdno, nth) 라도 account_id 다르면 중복 거부 안 됨', () => {
      const repo = setupRepo();
      const a = repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      const b = repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      expect(a.isOk()).toBe(true);
      expect(b.isOk()).toBe(true); // 다른 계좌면 OK
    });

    it('계좌 A의 replan 이 계좌 B의 lot 을 건드리지 않음', () => {
      const repo = setupRepo();
      repo.insertLot({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });
      repo.insertLot({
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 60000,
        qty: 5,
        amountKrw: 300_000,
        status: 'OPEN',
        boughtAt: new Date(),
      });

      const r = repo.replan(1, {
        pdno: '005930',
        entries: [{ nth: 1, buyPrice: 80000, qty: 12, amountKrw: 960_000, boughtAt: new Date() }],
      });
      expect(r.isOk()).toBe(true);

      const snapB = repo.snapshot(2, '005930');
      if (snapB.isErr()) throw new Error('snap');
      // 계좌 B 의 1차는 버틸어야 한다.
      expect(snapB.value.lots).toHaveLength(1);
      expect(snapB.value.lots[0]?.buyPrice).toBe(60000);
    });
  });
});

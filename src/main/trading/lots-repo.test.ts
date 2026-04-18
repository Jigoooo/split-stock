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
});

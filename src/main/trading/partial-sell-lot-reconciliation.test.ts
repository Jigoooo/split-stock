import { BROKERS } from '@shared/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { lots } from '../db/schema';
import { reconcileCancelledSellLot } from './partial-sell-lot-reconciliation';

describe('reconcileCancelledSellLot — Phase 6 multi-broker (lots.id PK 기반)', () => {
  it('체결 0주 매도 취소 시 KIS lot 을 OPEN 으로 복원', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        broker: BROKERS.KIS,
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();

    reconcileCancelledSellLot(db, {
      lotId: lot.id,
      filledQty: 0,
      executionPrice: 0,
      now,
    });

    expect(db.select().from(lots).where(eq(lots.id, lot.id)).get()).toMatchObject({
      status: 'OPEN',
      qty: 10,
      soldAt: null,
      sellPrice: null,
    });
  });

  it('체결 0주 매도 취소 시 KIWOOM lot 도 OPEN 으로 복원 (broker 필터 drop 검증)', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        broker: BROKERS.KIWOOM,
        accountId: 2,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();

    reconcileCancelledSellLot(db, {
      lotId: lot.id,
      filledQty: 0,
      executionPrice: 0,
      now,
    });

    // Phase 6: lots.id 가 PK 라 broker 필터 없이도 KIWOOM lot 을 정상 처리.
    expect(db.select().from(lots).where(eq(lots.id, lot.id)).get()).toMatchObject({
      broker: BROKERS.KIWOOM,
      status: 'OPEN',
      qty: 10,
    });
  });

  it('전량 체결 후 취소 시 SOLD 로 마킹', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        broker: BROKERS.KIS,
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();

    reconcileCancelledSellLot(db, {
      lotId: lot.id,
      filledQty: 10,
      executionPrice: 71000,
      now,
    });

    expect(db.select().from(lots).where(eq(lots.id, lot.id)).get()).toMatchObject({
      status: 'SOLD',
      sellPrice: 71000,
    });
  });

  it('일부 체결 후 취소 시 잔량 OPEN 으로 복원 + amountKrw 재계산', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        broker: BROKERS.KIS,
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 10,
        amountKrw: 700000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();

    reconcileCancelledSellLot(db, {
      lotId: lot.id,
      filledQty: 4,
      executionPrice: 71000,
      now,
    });

    expect(db.select().from(lots).where(eq(lots.id, lot.id)).get()).toMatchObject({
      status: 'OPEN',
      qty: 6,
      amountKrw: 70000 * 6, // buyPrice 기준 재계산
      soldAt: null,
      sellPrice: null,
    });
  });
});

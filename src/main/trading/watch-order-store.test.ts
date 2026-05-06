import { BROKERS } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb, type Db } from '../db/client';
import { accounts } from '../db/schema';
import type { WatchOrderInput } from './watch-engine-types';
import { upsertWatchOrder } from './watch-order-store';

function insertAccount(db: Db, id: number, broker: string): void {
  db.insert(accounts)
    .values({
      id,
      env: 'MOCK',
      broker,
      accountNo8: `${id}`.padStart(8, '0'),
      accountProdCd: '01',
      createdAt: new Date(),
    })
    .run();
}

const buyInput = (overrides: Partial<WatchOrderInput> = {}): WatchOrderInput => ({
  accountId: 1,
  pdno: '005930',
  source: 'CUSTOM',
  side: 'BUY',
  targetPrice: 60_000,
  comparator: 'LTE',
  orderType: 'LIMIT',
  qtyOrAmountMode: 'QTY',
  qty: 10,
  ...overrides,
});

describe('upsertWatchOrder — Phase 6 H1: 명시적 broker resolution', () => {
  it('KIS 계좌면 watchOrders.broker = KIS 로 INSERT', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    insertAccount(db, 1, BROKERS.KIS);

    const result = upsertWatchOrder(db, buyInput({ accountId: 1 }));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.accountId).toBe(1);
  });

  it('KIWOOM 계좌면 watchOrders.broker = KIWOOM 로 INSERT (multi-broker dispatch)', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    insertAccount(db, 2, BROKERS.KIWOOM);

    const result = upsertWatchOrder(db, buyInput({ accountId: 2 }));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error('expected ok');
    expect(result.value.accountId).toBe(2);
  });

  it('계좌 미존재 시 VALIDATION 에러 — silent KIS fallback 금지', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    // 계좌를 insert 하지 않음.

    const result = upsertWatchOrder(db, buyInput({ accountId: 999 }));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected validation error');
    expect(result.error.kind).toBe('VALIDATION');
    if (result.error.kind !== 'VALIDATION') throw new Error('expected VALIDATION');
    expect(result.error.message).toMatch(/account 999/);
  });

  it('UPBIT 계좌(non-domestic) 면 VALIDATION 에러', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    insertAccount(db, 3, BROKERS.UPBIT);

    const result = upsertWatchOrder(db, buyInput({ accountId: 3 }));

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected validation error');
    expect(result.error.kind).toBe('VALIDATION');
  });
});

import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { cryptoOrders, lots } from '../db/schema';
import { CryptoProtectionGuard } from './crypto-protection-guard';
import { ProtectionLimitsRepo } from './protection-limits-repo';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const repo = new ProtectionLimitsRepo(db);
  const guard = new CryptoProtectionGuard(db, repo, () => new Date('2026-05-03T10:00:00+09:00'));
  return { db, repo, guard };
}

describe('CryptoProtectionGuard', () => {
  it('passes when no limits configured', () => {
    const { guard } = setup();
    expect(guard.canBuyToday(1, 'KRW-BTC', 5000).isOk()).toBe(true);
  });

  it('blocks when daily total amount limit would be exceeded', () => {
    const { db, repo, guard } = setup();
    repo.upsert(1, { dailyTotalMaxAmount: 10_000, dailyTotalMaxAmountEnabled: true });
    db.insert(cryptoOrders)
      .values({
        accountId: 1,
        exchange: 'UPBIT',
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'price',
        state: 'wait',
        price: '6000',
        placedAt: new Date('2026-05-03T10:00:00+09:00'),
        updatedAt: new Date('2026-05-03T10:00:00+09:00'),
      })
      .run();
    const result = guard.canBuyToday(1, 'KRW-BTC', 5000);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('LIMIT_DAILY_TOTAL_AMOUNT');
  });

  it('blocks when account total exposure would be exceeded', () => {
    const { db, repo, guard } = setup();
    repo.upsert(1, { accountTotalMaxAmount: 20_000, accountTotalMaxAmountEnabled: true });
    db.insert(lots)
      .values({
        broker: 'UPBIT',
        accountId: 1,
        pdno: 'KRW-BTC',
        nth: 1,
        buyPrice: 0,
        qty: 0,
        amountKrw: 0,
        qtyDecimal: '0.001',
        buyPriceDecimal: '50000000',
        amountKrwDecimal: '15000',
        source: 'live',
        status: 'open',
        boughtAt: new Date('2026-05-03T10:00:00+09:00'),
      })
      .run();
    const result = guard.canBuyToday(1, 'KRW-BTC', 6000);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('LIMIT_ACCOUNT_TOTAL_AMOUNT');
  });

  it('blocks when per-symbol daily buy count exceeded', () => {
    const { db, repo, guard } = setup();
    repo.upsert(1, { perSymbolDailyMaxBuys: 1, perSymbolDailyMaxBuysEnabled: true });
    db.insert(cryptoOrders)
      .values({
        accountId: 1,
        exchange: 'UPBIT',
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'price',
        state: 'wait',
        price: '5000',
        placedAt: new Date('2026-05-03T10:00:00+09:00'),
        updatedAt: new Date('2026-05-03T10:00:00+09:00'),
      })
      .run();
    const result = guard.canBuyToday(1, 'KRW-BTC', 5000);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('LIMIT_PER_SYMBOL_DAILY_BUYS');
  });
});

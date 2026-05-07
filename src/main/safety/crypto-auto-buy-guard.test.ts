import { deriveCryptoStrategyAutoMode } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { cryptoOrders } from '../db/schema';
import { CryptoAutoTradingRepo } from '../crypto/crypto-auto-repo';
import { CryptoProtectionGuard } from './crypto-protection-guard';
import { ProtectionLimitsRepo } from './protection-limits-repo';
import { createRateGuardRepo } from './rate-guard';
import { CryptoAutoBuyGuard } from './crypto-auto-buy-guard';
import { AutoOrderBlockedError } from '../trading/auto-order-errors';

const MARKET = 'KRW-BTC';

function setup(now: Date = new Date('2026-05-07T00:30:00.000Z')) {
  const db = createTestDb();
  bootstrapSchema(db);
  const logger = { log: vi.fn() };
  const protectionLimitsRepo = new ProtectionLimitsRepo(db);
  const protectionGuard = new CryptoProtectionGuard(db, protectionLimitsRepo, () => now);
  const rateGuardRepo = createRateGuardRepo(db);
  const repo = new CryptoAutoTradingRepo(db);
  const guard = new CryptoAutoBuyGuard({
    logger: logger as never,
    protectionGuard,
    rateGuardRepo,
    repo,
    now: () => now,
  });
  return { db, guard, logger, protectionLimitsRepo, rateGuardRepo, repo };
}

function insertTodayBuyOrder(db: ReturnType<typeof createTestDb>): void {
  db.insert(cryptoOrders)
    .values({
      accountId: 1,
      exchange: 'UPBIT',
      uuid: `u-${Math.random()}`,
      identifier: `id-${Math.random()}`,
      market: MARKET,
      side: 'bid',
      ordType: 'price',
      price: '50000000',
      volume: '0.001',
      remainingVolume: '0',
      executedVolume: '0.001',
      paidFee: '0',
      locked: '0',
      state: 'done',
      placedAt: new Date('2026-05-07T00:20:00.000Z'),
      updatedAt: new Date('2026-05-07T00:21:00.000Z'),
    })
    .run();
}

function expectBlocked(fn: () => void, code: AutoOrderBlockedError['code']): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AutoOrderBlockedError);
    expect((error as AutoOrderBlockedError).code).toBe(code);
    return;
  }
  throw new Error(`Expected AutoOrderBlockedError(${code})`);
}

describe('CryptoAutoBuyGuard', () => {
  it('보호 한도 OFF이면 주문이 있어도 자동매수를 차단하지 않는다', () => {
    const { db, guard, protectionLimitsRepo } = setup();
    protectionLimitsRepo.upsert(1, {
      perSymbolDailyMaxBuysEnabled: false,
      perSymbolDailyMaxBuys: 1,
    });
    insertTodayBuyOrder(db);

    expect(() =>
      guard.assertAutoBuyAllowed({
        accountId: 1,
        market: MARKET,
        amountKrw: 50_000,
        source: 'STRATEGY',
      }),
    ).not.toThrow();
  });

  it('보호 한도 ON이면 UPBIT 주문 전 자동매수를 차단한다', () => {
    const { db, guard, protectionLimitsRepo } = setup();
    protectionLimitsRepo.upsert(1, {
      perSymbolDailyMaxBuysEnabled: true,
      perSymbolDailyMaxBuys: 1,
    });
    insertTodayBuyOrder(db);

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({
        accountId: 1,
        market: MARKET,
        amountKrw: 50_000,
        source: 'STRATEGY',
      });
    }, 'AUTO_BUY_PROTECTION_LIMIT');
  });

  it('RateGuard 비활성화이면 N+1번째 시도도 차단하지 않는다', () => {
    const { guard, rateGuardRepo } = setup();
    rateGuardRepo.updateSettings(1, false, 40, 1);

    guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });

    // no throw — guard is disabled
  });

  it('연속 자동매수 N+1번째 시도는 차단하고 해당 마켓을 SELL_ONLY로 전환한다', () => {
    const { guard, rateGuardRepo, repo } = setup();
    rateGuardRepo.updateSettings(1, true, 40, 1);

    guard.assertAutoBuyAllowed({
      accountId: 1,
      market: MARKET,
      amountKrw: 50_000,
      source: 'STRATEGY',
    });

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({
        accountId: 1,
        market: MARKET,
        amountKrw: 50_000,
        source: 'STRATEGY',
      });
    }, 'AUTO_BUY_RATE_GUARD');

    const strategy = repo.getStrategy(1, MARKET);
    expect(deriveCryptoStrategyAutoMode(strategy)).toBe('SELL_ONLY');
  });

  it('보호 한도 위반 시 RateGuard 카운트를 증가시키지 않는다', () => {
    const { db, guard, protectionLimitsRepo, rateGuardRepo } = setup();
    protectionLimitsRepo.upsert(1, {
      perSymbolDailyMaxBuysEnabled: true,
      perSymbolDailyMaxBuys: 1,
    });
    rateGuardRepo.updateSettings(1, true, 40, 1);
    insertTodayBuyOrder(db);

    // protection block — should not increment rate guard
    expectBlocked(() => {
      guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    }, 'AUTO_BUY_PROTECTION_LIMIT');

    // rate guard was not incremented — still at 0 of 1, no throw yet even if protection is lifted
    // verify by checking guard throws PROTECTION not RATE_GUARD on second blocked call
    expectBlocked(() => {
      guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    }, 'AUTO_BUY_PROTECTION_LIMIT');
  });

  it('계좌가 다르면 RateGuard 카운트가 분리된다', () => {
    const { guard, rateGuardRepo } = setup();
    rateGuardRepo.updateSettings(1, true, 40, 1);
    rateGuardRepo.updateSettings(2, true, 40, 1);

    // accountId=1: 1st attempt (ok)
    guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    // accountId=2: 1st attempt (ok — independent counter)
    guard.assertAutoBuyAllowed({ accountId: 2, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });

    // accountId=1: 2nd attempt (blocked)
    expectBlocked(() => {
      guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    }, 'AUTO_BUY_RATE_GUARD');

    // accountId=2: 2nd attempt (also blocked — its own counter hit)
    expectBlocked(() => {
      guard.assertAutoBuyAllowed({ accountId: 2, market: MARKET, amountKrw: 50_000, source: 'STRATEGY' });
    }, 'AUTO_BUY_RATE_GUARD');
  });

  it('BOOSTER source도 RateGuard를 발동한다', () => {
    const { guard, rateGuardRepo } = setup();
    rateGuardRepo.updateSettings(1, true, 40, 1);

    guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'BOOSTER' });

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({ accountId: 1, market: MARKET, amountKrw: 50_000, source: 'BOOSTER' });
    }, 'AUTO_BUY_RATE_GUARD');
  });
});

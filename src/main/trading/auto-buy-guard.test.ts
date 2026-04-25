import { deriveStrategyAutoMode } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { orders } from '../db/schema';
import { SettingsRepo } from '../db/settings-repo';
import { ProtectionGuard } from '../safety/protection-guard';
import { ProtectionLimitsRepo } from '../safety/protection-limits-repo';
import { createRateGuardRepo } from '../safety/rate-guard';
import { createTimeWindowRepo } from '../safety/time-window';
import { AutoBuyGuard } from './auto-buy-guard';
import { AutoOrderBlockedError } from './auto-order-errors';
import { StrategyRepo } from './strategy-repo';

function setup(now: Date = new Date('2026-04-24T00:30:00.000Z')) {
  const db = createTestDb();
  bootstrapSchema(db);
  const logger = { log: vi.fn() };
  const protectionLimitsRepo = new ProtectionLimitsRepo(db);
  const protectionGuard = new ProtectionGuard(db, protectionLimitsRepo, () => now);
  const rateGuardRepo = createRateGuardRepo(db);
  const timeWindowRepo = createTimeWindowRepo(db);
  const strategyRepo = new StrategyRepo(new SettingsRepo(db), logger as never);
  const guard = new AutoBuyGuard({
    logger: logger as never,
    protectionGuard,
    rateGuardRepo,
    strategyRepo,
    timeWindowRepo,
    now: () => now,
  });
  return { db, guard, logger, protectionLimitsRepo, rateGuardRepo, strategyRepo, timeWindowRepo };
}

function insertTodayBuyOrder(db: ReturnType<typeof createTestDb>): void {
  db.insert(orders)
    .values({
      accountId: 1,
      lotId: null,
      odno: `O-${Math.random()}`,
      orgNo: null,
      pdno: '005930',
      side: 'BUY',
      division: 'LIMIT',
      qty: 1,
      price: 10_000,
      status: 'FILLED',
      placedAt: new Date('2026-04-24T00:20:00.000Z'),
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

describe('AutoBuyGuard', () => {
  it('보호 한도 OFF 항목은 값이 있어도 자동매수를 차단하지 않는다', () => {
    const { db, guard, protectionLimitsRepo } = setup();
    protectionLimitsRepo.upsert(1, {
      perSymbolDailyMaxBuysEnabled: false,
      perSymbolDailyMaxBuys: 1,
    });
    insertTodayBuyOrder(db);

    expect(() =>
      guard.assertAutoBuyAllowed({
        accountId: 1,
        amountKrw: 10_000,
        pdno: '005930',
        source: 'STRATEGY',
      }),
    ).not.toThrow();
  });

  it('보호 한도 ON 항목은 KIS 주문 전 자동매수를 차단한다', () => {
    const { db, guard, protectionLimitsRepo } = setup();
    protectionLimitsRepo.upsert(1, {
      perSymbolDailyMaxBuysEnabled: true,
      perSymbolDailyMaxBuys: 1,
    });
    insertTodayBuyOrder(db);

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({
        accountId: 1,
        amountKrw: 10_000,
        pdno: '005930',
        source: 'STRATEGY',
      });
    }, 'AUTO_BUY_PROTECTION_LIMIT');
  });

  it('매수 허용 시간대 밖이면 자동매수를 차단한다', () => {
    const { guard, timeWindowRepo } = setup(new Date('2026-04-24T02:00:00.000Z')); // KST 11:00
    timeWindowRepo.upsert(1, 'BUY', 1, true, 540, 600); // KST 09:00~10:00

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({
        accountId: 1,
        amountKrw: 10_000,
        pdno: '005930',
        source: 'WATCH',
      });
    }, 'AUTO_BUY_TIME_WINDOW');
  });

  it('연속 자동매수 N+1번째 시도는 차단하고 해당 종목을 매도만 ON으로 낮춘다', () => {
    const { guard, rateGuardRepo, strategyRepo } = setup();
    rateGuardRepo.updateSettings(1, true, 40, 1);

    guard.assertAutoBuyAllowed({
      accountId: 1,
      amountKrw: 10_000,
      pdno: '005930',
      source: 'WATCH',
    });

    expectBlocked(() => {
      guard.assertAutoBuyAllowed({
        accountId: 1,
        amountKrw: 10_000,
        pdno: '005930',
        source: 'WATCH',
      });
    }, 'AUTO_BUY_RATE_GUARD');

    const active = strategyRepo.getActive(1, '005930')._unsafeUnwrap();
    expect(active).not.toBeNull();
    expect(active ? deriveStrategyAutoMode(active) : null).toBe('SELL_ONLY');
  });
});

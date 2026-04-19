import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { lots, orders } from '../db/schema';
import { ProtectionGuard } from './protection-guard';
import { ProtectionLimitsRepo } from './protection-limits-repo';

function makeDb() {
  const db = createTestDb();
  bootstrapSchema(db);
  return db;
}

/** KST 기준 오늘 12:00 시각 */
function kstNoon(): Date {
  // KST 정오 = UTC 03:00
  const d = new Date();
  d.setUTCHours(3, 0, 0, 0);
  return d;
}

/** KST 기준 어제 12:00 시각 */
function kstYesterdayNoon(): Date {
  const d = kstNoon();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function insertBuyOrder(
  db: ReturnType<typeof makeDb>,
  accountId: number,
  pdno: string,
  price: number,
  qty: number,
  status: string,
  placedAt: Date,
) {
  db.insert(orders)
    .values({
      accountId,
      lotId: null,
      odno: Math.random().toString(36).slice(2),
      orgNo: null,
      pdno,
      side: 'BUY',
      division: 'LIMIT',
      qty,
      price,
      status,
      placedAt,
    })
    .run();
}

function insertOpenLot(
  db: ReturnType<typeof makeDb>,
  accountId: number,
  pdno: string,
  amountKrw: number,
) {
  db.insert(lots)
    .values({
      accountId,
      pdno,
      nth: 1,
      buyPrice: amountKrw,
      qty: 1,
      amountKrw,
      status: 'OPEN',
      boughtAt: new Date(),
    })
    .run();
}

describe('ProtectionGuard.canBuyToday', () => {
  it('한도 미설정 시 항상 통과', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);

    const result = guard.canBuyToday(1, '005930', 1_000_000);
    expect(result.isOk()).toBe(true);
  });

  it('perSymbolDailyMaxBuys 한도 미달 → 통과', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 3 });

    // 오늘 2건 존재
    insertBuyOrder(db, 1, '005930', 10000, 1, 'FILLED', kstNoon());
    insertBuyOrder(db, 1, '005930', 10000, 1, 'PENDING', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '005930', 10000).isOk()).toBe(true);
  });

  it('perSymbolDailyMaxBuys 한도 초과 → 차단', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 2 });

    insertBuyOrder(db, 1, '005930', 10000, 1, 'FILLED', kstNoon());
    insertBuyOrder(db, 1, '005930', 10000, 1, 'PENDING', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    const result = guard.canBuyToday(1, '005930', 10000);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('LIMIT_PER_SYMBOL_DAILY_BUYS');
    }
  });

  it('어제 주문은 오늘 한도 집계에 포함되지 않음', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 1 });

    // 어제 주문 1건
    insertBuyOrder(db, 1, '005930', 10000, 1, 'FILLED', kstYesterdayNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '005930', 10000).isOk()).toBe(true);
  });

  it('다른 계좌 주문은 카운트에 포함 안 됨', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 1 });

    // 계좌 2의 주문
    insertBuyOrder(db, 2, '005930', 10000, 1, 'FILLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '005930', 10000).isOk()).toBe(true);
  });

  it('다른 종목 주문은 perSymbolDailyMaxBuys 에 포함 안 됨', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 1 });

    // 다른 종목 주문
    insertBuyOrder(db, 1, '000660', 10000, 1, 'FILLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '005930', 10000).isOk()).toBe(true);
  });

  it('dailyTotalMaxCount 한도 초과 → 차단', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { dailyTotalMaxCount: 3 });

    insertBuyOrder(db, 1, '005930', 10000, 1, 'FILLED', kstNoon());
    insertBuyOrder(db, 1, '000660', 10000, 1, 'FILLED', kstNoon());
    insertBuyOrder(db, 1, '035720', 10000, 1, 'PENDING', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    const result = guard.canBuyToday(1, '005380', 10000);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('LIMIT_DAILY_TOTAL_COUNT');
    }
  });

  it('dailyTotalMaxAmount 한도 초과 → 차단', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { dailyTotalMaxAmount: 1_000_000 });

    // 900,000원 이미 사용
    insertBuyOrder(db, 1, '005930', 900_000, 1, 'FILLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    // 200,000원 추가하면 초과
    const result = guard.canBuyToday(1, '000660', 200_000);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('LIMIT_DAILY_TOTAL_AMOUNT');
    }
  });

  it('dailyTotalMaxAmount 한도 이내 → 통과', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { dailyTotalMaxAmount: 1_000_000 });

    insertBuyOrder(db, 1, '005930', 500_000, 1, 'FILLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '000660', 499_000).isOk()).toBe(true);
  });

  it('accountTotalMaxAmount OPEN 포지션 초과 → 차단', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { accountTotalMaxAmount: 2_000_000 });

    insertOpenLot(db, 1, '005930', 1_800_000);

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    // 300,000 추가 시 2,100,000 → 초과
    const result = guard.canBuyToday(1, '000660', 300_000);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('LIMIT_ACCOUNT_TOTAL_AMOUNT');
    }
  });

  it('accountTotalMaxAmount OPEN 포지션 이내 → 통과', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { accountTotalMaxAmount: 2_000_000 });

    insertOpenLot(db, 1, '005930', 1_500_000);

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '000660', 400_000).isOk()).toBe(true);
  });

  it('CANCELLED 주문은 일일 매수 카운트에 포함 안 됨', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    limitsRepo.upsert(1, { perSymbolDailyMaxBuys: 1 });

    // CANCELLED 주문은 무효
    insertBuyOrder(db, 1, '005930', 10000, 1, 'CANCELLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    expect(guard.canBuyToday(1, '005930', 10000).isOk()).toBe(true);
  });

  it('복합 한도 — 가장 먼저 위반된 한도를 반환', () => {
    const db = makeDb();
    const limitsRepo = new ProtectionLimitsRepo(db);
    // perSymbolDailyMaxBuys 먼저 위반
    limitsRepo.upsert(1, {
      perSymbolDailyMaxBuys: 1,
      dailyTotalMaxCount: 5,
      dailyTotalMaxAmount: 10_000_000,
    });

    insertBuyOrder(db, 1, '005930', 10000, 1, 'FILLED', kstNoon());

    const guard = new ProtectionGuard(db, limitsRepo, kstNoon);
    const result = guard.canBuyToday(1, '005930', 10000);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('LIMIT_PER_SYMBOL_DAILY_BUYS');
    }
  });
});

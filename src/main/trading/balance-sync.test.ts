import type { Holding } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { FakeBrokerAdapter } from '../brokers/__tests__/fake-broker-adapter';
import type { Timer } from '../brokers/core/types';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { BalanceSync } from './balance-sync';
import { LotsRepo } from './lots-repo';

// ── helpers ──────────────────────────────────────────────────────────────────

function createFakeLogger(): EventLogger & {
  entries: Array<{ level: string; message: string; payload?: unknown }>;
} {
  const entries: Array<{ level: string; message: string; payload?: unknown }> = [];
  return {
    entries,
    log(entry) {
      entries.push({ level: entry.level, message: entry.message, payload: entry.payload });
    },
  };
}

function createFakeTimer(): Timer & { tickInterval(): void } {
  let intervalCb: (() => void) | null = null;
  return {
    tickInterval() {
      if (intervalCb) intervalCb();
    },
    setTimeout(cb, _ms) {
      const h = setTimeout(cb, 0);
      return { clear: () => clearTimeout(h) };
    },
    setInterval(cb, _ms) {
      intervalCb = cb;
      return {
        clear: () => {
          intervalCb = null;
        },
      };
    },
    now: () => Date.now(),
  };
}

function makeHolding(pdno: string, qty: number, avgPrice = 70_000): Holding {
  return {
    symbol: pdno,
    name: `종목_${pdno}`,
    qty,
    avgPrice,
    currentPrice: 72_000,
    evalAmount: qty * 72_000,
    pnlAmount: qty * 2_000,
    pnlRate: 2.86,
  };
}

function makeFakeBroker(holdings: Holding[]): FakeBrokerAdapter {
  return new FakeBrokerAdapter({
    balance: {
      positions: holdings,
      deposit: 5_000_000,
      d2Deposit: 4_500_000,
      totalEval: 10_000_000,
      estimatedAsset: 10_000_000,
    },
  });
}

function setupDb(): { lotsRepo: LotsRepo } {
  const db = createTestDb();
  bootstrapSchema(db);
  return { lotsRepo: new LotsRepo(db) };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('BalanceSync', () => {
  it('start() → setInterval 등록, stop() → 해제', () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    const broker = makeFakeBroker([]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
      intervalMs: 1000,
    });

    sync.start();
    sync.stop();
    timer.tickInterval();
    expect(broker.callCount.inquireBalance).toBe(0);
  });

  it('refresh() → 즉시 inquireBalance 호출', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    const broker = makeFakeBroker([makeHolding('005930', 14)]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    expect(broker.callCount.inquireBalance).toBe(1);
    const fetchedLog = logger.entries.find((e) => e.message === 'balance-sync.fetched');
    expect(fetchedLog).toBeDefined();
    expect((fetchedLog?.payload as { positionCount: number }).positionCount).toBe(1);
  });

  it('lots qty === broker qty → drift 로그 없음', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    const broker = makeFakeBroker([makeHolding('005930', 14)]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const driftLog = logger.entries.find((e) => e.message === 'balance-sync.drift_detected');
    expect(driftLog).toBeUndefined();
  });

  it('lots qty !== broker qty → drift WARN 로그 발생', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 14,
      amountKrw: 980_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    // broker 는 20주, lots 는 14주 → 괴리 6주
    const broker = makeFakeBroker([makeHolding('005930', 20)]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const driftLog = logger.entries.find((e) => e.message === 'balance-sync.drift_detected');
    expect(driftLog).toBeDefined();
    expect(driftLog?.level).toBe('WARN');
    const payload = driftLog?.payload as {
      pdno: string;
      lotsQty: number;
      kisQty: number;
      diff: number;
    };
    expect(payload.pdno).toBe('005930');
    expect(payload.lotsQty).toBe(14);
    expect(payload.kisQty).toBe(20);
    expect(payload.diff).toBe(6);
  });

  it('broker 보유는 있는데 lot row 가 없으면 OPEN 1차를 자동 복구한다', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    const broker = makeFakeBroker([makeHolding('452450', 6)]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    const recovered = lotsRepo.listRows(1, '452450');
    expect(recovered.isOk()).toBe(true);
    if (recovered.isErr()) throw new Error('rows failed');
    expect(recovered.value).toHaveLength(1);
    expect(recovered.value[0]).toMatchObject({
      nth: 1,
      pdno: '452450',
      qty: 6,
      status: 'OPEN',
    });
    expect(logger.entries.some((entry) => entry.message === 'balance-sync.orphan_recovered')).toBe(
      true,
    );
  });

  it('broker null → poll skip', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();

    const sync = new BalanceSync({
      getBroker: () => null,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    expect(logger.entries).toHaveLength(0);
  });

  it('accountId null → poll skip (broker 호출 없음)', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    const broker = makeFakeBroker([]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => null,
      lotsRepo,
      logger,
      timer,
    });

    await sync.refresh();

    expect(broker.callCount.inquireBalance).toBe(0);
  });

  it('dispose() 후 refresh() 호출 → no-op', async () => {
    const timer = createFakeTimer();
    const logger = createFakeLogger();
    const { lotsRepo } = setupDb();
    const broker = makeFakeBroker([]);

    const sync = new BalanceSync({
      getBroker: () => broker,
      getAccountId: () => 1,
      lotsRepo,
      logger,
      timer,
    });

    sync.dispose();
    await sync.refresh();

    expect(broker.callCount.inquireBalance).toBe(0);
  });
});

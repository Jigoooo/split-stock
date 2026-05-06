import type { Holding } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { FakeBrokerAdapter } from '../brokers/__tests__/fake-broker-adapter';
import type { Timer } from '../brokers/core/types';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { seedDomesticAccounts } from '../testing/seed-accounts';
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

function createFakeTimer(): Timer & {
  tickInterval(): void;
  pendingTimeouts(): number;
  flushTimeouts(): void;
} {
  let intervalCb: (() => void) | null = null;
  const timeoutCbs = new Set<() => void>();
  return {
    tickInterval() {
      if (intervalCb) intervalCb();
    },
    pendingTimeouts() {
      return timeoutCbs.size;
    },
    flushTimeouts() {
      const snapshot = Array.from(timeoutCbs);
      timeoutCbs.clear();
      for (const cb of snapshot) cb();
    },
    setTimeout(cb, _ms) {
      const wrapped = (): void => {
        timeoutCbs.delete(wrapped);
        cb();
      };
      timeoutCbs.add(wrapped);
      return {
        clear: () => {
          timeoutCbs.delete(wrapped);
        },
      };
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
  seedDomesticAccounts(db);
  return { lotsRepo: new LotsRepo(db) };
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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

  it('refreshWithBackoff() → 즉시 1회 + backoff 2회 시퀀스 호출 (Q-E)', async () => {
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

    // 즉시(0ms) + 3초 + 5초 = 총 3개 시퀀스. 즉시 호출 1회 + pending timer 2개 등록.
    sync.refreshWithBackoff();
    await flushAsync();
    expect(broker.callCount.inquireBalance).toBe(1);
    expect(timer.pendingTimeouts()).toBe(2);

    // 첫 backoff timer 발화 → 두 번째 poll 진행. 첫 poll 은 이미 완료된 상태.
    timer.flushTimeouts();
    await flushAsync();
    // 두 timer 가 동시에 발화하면 두 번째는 첫 poll 의 running 가드로 인해 skip 될 수 있으나,
    // 첫 poll 이 await 만 가득한 sync 작업이라 microtask drain 후 완료. 최종 호출 횟수 ≥ 2.
    expect(broker.callCount.inquireBalance).toBeGreaterThanOrEqual(2);
    expect(timer.pendingTimeouts()).toBe(0);
  });

  it('refreshWithBackoff() 후 dispose() → pending backoff timer 모두 clear', async () => {
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

    sync.refreshWithBackoff();
    await Promise.resolve();
    expect(timer.pendingTimeouts()).toBe(2);

    sync.dispose();
    expect(timer.pendingTimeouts()).toBe(0);
  });
});

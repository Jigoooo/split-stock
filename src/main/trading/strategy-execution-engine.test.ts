import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import { FeedBus } from '../realtime/feed-bus';
import { SafetyStateRegistry } from '../safety/safety-state';
import { LotsRepo } from './lots-repo';
import { StrategyExecutionEngine } from './strategy-execution-engine';
import { StrategyRepo } from './strategy-repo';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const settings = new SettingsRepo(db);
  const logger = { log: vi.fn() };
  const lotsRepo = new LotsRepo(db);
  const strategyRepo = new StrategyRepo(settings, logger as never);
  const bus = new FeedBus();
  const safetyRegistry = new SafetyStateRegistry({ logger: logger as never });
  safetyRegistry.get(1).setMaster(true);
  return { bus, db, logger, lotsRepo, safetyRegistry, strategyRepo };
}

describe('StrategyExecutionEngine', () => {
  it('active cycle + 글로벌 전략이 있으면 하락시 다음 차수 매수 주문을 생성한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 10,
      amountKrw: 700000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    strategyRepo.setActive(1, null, {
      totalAmountKrw: 1_400_000,
      maxStages: 3,
      dropPct: 0.03,
      profitPct: 0.05,
      autoBuyEnabled: true,
      autoBuyOrderType: 'LIMIT',
      autoSellEnabled: true,
      autoSellOrderType: 'LIMIT',
    });
    const executeOrder = vi.fn(async () => undefined);

    const engine = new StrategyExecutionEngine({
      bus,
      logger: { log: vi.fn() } as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
    });
    engine.refreshTrackedSymbols();

    bus.emitTick({
      pdno: '005930',
      time: '093000',
      price: 67800,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 1,
      accumVolume: 1,
      open: 67800,
      high: 67800,
      low: 67800,
      bestAsk: 67800,
      bestBid: 67800,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1,
        nth: 2,
        pdno: '005930',
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    );
  });

  it('active cycle가 없으면 추적 종목이 없다', () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70000,
      qty: 10,
      amountKrw: 700000,
      status: 'SOLD',
      boughtAt: new Date(),
    });
    const tracked: string[][] = [];
    const engine = new StrategyExecutionEngine({
      bus,
      logger: { log: vi.fn() } as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder: vi.fn(async () => undefined),
      onTrackedPdnosChanged: (pdnos) => tracked.push(pdnos),
    });

    engine.refreshTrackedSymbols();

    expect(tracked.at(-1)).toEqual([]);
  });

  it('상승시 해당 차수 익절 주문을 생성한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 2,
      buyPrice: 68000,
      qty: 10,
      amountKrw: 680000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    strategyRepo.setActive(1, null, {
      totalAmountKrw: 1_000_000,
      maxStages: 3,
      dropPct: 0.03,
      profitPct: 0.05,
      autoBuyEnabled: true,
      autoBuyOrderType: 'LIMIT',
      autoSellEnabled: true,
      autoSellOrderType: 'LIMIT',
    });
    const executeOrder = vi.fn(async () => undefined);

    const engine = new StrategyExecutionEngine({
      bus,
      logger: { log: vi.fn() } as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
    });
    engine.refreshTrackedSymbols();

    bus.emitTick({
      pdno: '005930',
      time: '093000',
      price: 71400,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 1,
      accumVolume: 1,
      open: 71400,
      high: 71400,
      low: 71400,
      bestAsk: 71400,
      bestBid: 71400,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1,
        nth: 2,
        pdno: '005930',
        side: 'SELL',
        triggerReason: 'PROFIT_SELL',
      }),
    );
  });
});

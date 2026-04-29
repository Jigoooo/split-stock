import { type BrokerErrorKind, createStrategyRules, makeBrokerError } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Timer } from '../brokers/core/types';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import { FeedBus } from '../realtime/feed-bus';
import { SafetyStateRegistry } from '../safety/safety-state';
import { AutoOrderBlockedError } from './auto-order-errors';
import { LotsRepo } from './lots-repo';
import { StockMasterRepo } from './stock-master-repo';
import { StrategyExecutionEngine } from './strategy-execution-engine';
import { StrategyRepo } from './strategy-repo';
import { StrategyOrderError, type StrategyOrderInput } from './watch-order-executor';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const settings = new SettingsRepo(db);
  const logger = { log: vi.fn() };
  const stockMasterRepo = new StockMasterRepo(db);
  const lotsRepo = new LotsRepo(db, stockMasterRepo);
  const strategyRepo = new StrategyRepo(settings, logger as never);
  const bus = new FeedBus();
  const safetyRegistry = new SafetyStateRegistry({ logger: logger as never });
  safetyRegistry.get(1).setMaster(true);
  return { bus, logger, lotsRepo, safetyRegistry, strategyRepo };
}

function setDefaultProfile(strategyRepo: StrategyRepo) {
  strategyRepo.setActive(1, null, {
    version: 2,
    maxStages: 3,
    ...createStrategyRules(3, {
      amountKrw: 700_000,
      dropPct: 0.03,
      profitPct: 0.05,
    }),
    autoBuyEnabled: true,
    autoBuyOrderType: 'LIMIT',
    autoSellEnabled: true,
    autoSellOrderType: 'LIMIT',
  });
}

function emitSamsungTick(bus: FeedBus, price: number): void {
  bus.emitTick({
    pdno: '005930',
    time: '093000',
    price,
    dayChange: 0,
    dayChangeRate: 0,
    tickDirection: 'FLAT',
    volume: 1,
    accumVolume: 1,
    open: price,
    high: price,
    low: price,
    bestAsk: price,
    bestBid: price,
  });
}

function makeStrategyOrderFailure(
  kind: BrokerErrorKind,
  message: string,
  input: Partial<StrategyOrderInput> = {},
): StrategyOrderError {
  return new StrategyOrderError(
    {
      accountId: 1,
      division: 'LIMIT',
      nth: 2,
      pdno: '005930',
      price: 67_800,
      qty: 10,
      side: 'BUY',
      triggerReason: 'DROP_BUY',
      ...input,
    },
    makeBrokerError({
      brokerId: 'KIS',
      kind,
      msg: message,
    }),
    new Date('2026-04-29T09:30:00+09:00'),
  );
}

describe('StrategyExecutionEngine', () => {
  it('하락시 다음 차수 buyRule로 매수 주문을 생성한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
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
      price: 67_800,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 1,
      accumVolume: 1,
      open: 67_800,
      high: 67_800,
      low: 67_800,
      bestAsk: 67_800,
      bestBid: 67_800,
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

  it('자동매수 일시 실패는 safety lock 대신 재시도 예약과 사용자 노출 이벤트를 남긴다', async () => {
    const { bus, logger, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const failure = makeStrategyOrderFailure('RATE_LIMITED', '호출 제한으로 잠시 대기합니다.');
    const executeOrder = vi.fn(async () => {
      throw failure;
    });
    let now = 1_000;
    const scheduledRetries: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    const timer: Timer = {
      now: () => now,
      setTimeout: (cb, ms) => {
        scheduledRetries.push(cb);
        scheduledDelays.push(ms);
        return { clear: vi.fn() };
      },
      setInterval: () => ({ clear: vi.fn() }),
    };
    const onAutoOrderRetryScheduled = vi.fn();

    const engine = new StrategyExecutionEngine({
      bus,
      logger: logger as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      timer,
      onAutoOrderRetryScheduled,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        category: 'FSM',
        message: 'strategy-engine.order-retry-scheduled',
        payload: expect.objectContaining({
          accountId: 1,
          pdno: '005930',
          reason: failure.message,
          side: 'BUY',
          triggerReason: 'DROP_BUY',
        }),
      }),
    );
    expect(safetyRegistry.get(1).getSnapshot()).toMatchObject({
      master: true,
      errorLock: { active: false },
    });
    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1,
        attempt: 1,
        errorKind: 'RATE_LIMITED',
        failureType: 'FAILED',
        nth: 2,
        pdno: '005930',
        reason: failure.message,
        retryAfterMs: 3_000,
        side: 'BUY',
        status: 'RETRYING',
      }),
    );

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledTimes(1);

    now += 1_000;
    scheduledRetries.at(-1)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeOrder).toHaveBeenCalledTimes(2);
  });

  it('자동매도 일시 실패도 safety lock 대신 재시도 예약과 사용자 노출 이벤트를 남긴다', async () => {
    const { bus, logger, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 2,
      buyPrice: 68_000,
      qty: 10,
      amountKrw: 680_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const failure = makeStrategyOrderFailure('NETWORK', '일시 연결 문제', {
      side: 'SELL',
      triggerReason: 'PROFIT_SELL',
    });
    const executeOrder = vi.fn(async () => {
      throw failure;
    });
    let now = 1_000;
    const scheduledRetries: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    const timer: Timer = {
      now: () => now,
      setTimeout: (cb, ms) => {
        scheduledRetries.push(cb);
        scheduledDelays.push(ms);
        return { clear: vi.fn() };
      },
      setInterval: () => ({ clear: vi.fn() }),
    };
    const onAutoOrderRetryScheduled = vi.fn();

    const engine = new StrategyExecutionEngine({
      bus,
      logger: logger as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      timer,
      onAutoOrderRetryScheduled,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 71_400);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledTimes(1);
    expect(safetyRegistry.get(1).getSnapshot()).toMatchObject({
      master: true,
      errorLock: { active: false },
    });
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        category: 'FSM',
        message: 'strategy-engine.order-retry-scheduled',
        payload: expect.objectContaining({
          accountId: 1,
          pdno: '005930',
          nth: 2,
          reason: failure.message,
          retryAfterMs: 3_000,
          side: 'SELL',
        }),
      }),
    );
    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 1,
        attempt: 1,
        errorKind: 'NETWORK',
        failureType: 'FAILED',
        nth: 2,
        pdno: '005930',
        reason: failure.message,
        retryAfterMs: 3_000,
        side: 'SELL',
        status: 'RETRYING',
      }),
    );
    expect(scheduledDelays.at(-1)).toBe(3_000);

    emitSamsungTick(bus, 71_400);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeOrder).toHaveBeenCalledTimes(1);

    now += 3_000;
    scheduledRetries.at(-1)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeOrder).toHaveBeenCalledTimes(2);
    expect(executeOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reconcileOnly: true,
        side: 'SELL',
      }),
    );
  });

  it('자동주문 영구 실패는 3초 재시도 대신 확인 필요 이벤트만 남긴다', async () => {
    const { bus, logger, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const failure = makeStrategyOrderFailure('VALIDATION', '주문 수량이 유효하지 않습니다.');
    const executeOrder = vi.fn(async () => {
      throw failure;
    });
    const scheduledRetries: Array<() => void> = [];
    const timer: Timer = {
      now: () => 1_000,
      setTimeout: (cb, _ms) => {
        scheduledRetries.push(cb);
        return { clear: vi.fn() };
      },
      setInterval: () => ({ clear: vi.fn() }),
    };
    const onAutoOrderRetryScheduled = vi.fn();

    const engine = new StrategyExecutionEngine({
      bus,
      logger: logger as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      timer,
      onAutoOrderRetryScheduled,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeOrder).toHaveBeenCalledTimes(1);
    expect(scheduledRetries).toHaveLength(0);
    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        errorKind: 'VALIDATION',
        retryAfterMs: null,
        status: 'NEEDS_ATTENTION',
      }),
    );
    expect(safetyRegistry.get(1).getSnapshot()).toMatchObject({
      master: true,
      errorLock: { active: false },
    });

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeOrder).toHaveBeenCalledTimes(1);
  });

  it('영업일/장 상태 비즈니스 실패는 조건 대기 이벤트로 표시한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const failure = makeStrategyOrderFailure('BUSINESS', '모의투자 영업일이 아닙니다.');
    const executeOrder = vi.fn(async () => {
      throw failure;
    });
    const onAutoOrderRetryScheduled = vi.fn();

    const engine = new StrategyExecutionEngine({
      bus,
      logger: { log: vi.fn() } as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      onAutoOrderRetryScheduled,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        errorKind: 'BUSINESS',
        retryAfterMs: null,
        status: 'WAITING_CONDITION',
      }),
    );
  });

  it('reconciled 이벤트는 기존 재시도 errorKind 가 있을 때만 포함한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const executeOrder = vi.fn(async () => ({
      brokerOrderId: '9001',
      reconciled: true,
    }));
    const onAutoOrderRetryScheduled = vi.fn();

    const engine = new StrategyExecutionEngine({
      bus,
      logger: { log: vi.fn() } as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      onAutoOrderRetryScheduled,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.not.objectContaining({
        errorKind: expect.any(String),
      }),
    );
    expect(onAutoOrderRetryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RECONCILED',
      }),
    );
  });

  it('장 사전 가드가 차단하면 주문 시도 없이 로그만 남긴다', async () => {
    const { bus, logger, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
    const executeOrder = vi.fn(async () => undefined);
    const marketSessionGuard = {
      assertAutoOrderAllowed: vi.fn(async () => {
        throw new AutoOrderBlockedError('MARKET_WEEKEND', '자동주문 차단: 주말');
      }),
    };

    const engine = new StrategyExecutionEngine({
      bus,
      logger: logger as never,
      lotsRepo,
      strategyRepo,
      safetyRegistry,
      getActiveAccountId: () => 1,
      executeOrder,
      marketSessionGuard,
    });
    engine.refreshTrackedSymbols();

    emitSamsungTick(bus, 67_800);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(marketSessionGuard.assertAutoOrderAllowed).toHaveBeenCalledWith({
      accountId: 1,
      pdno: '005930',
      side: 'BUY',
      source: 'STRATEGY',
    });
    expect(executeOrder).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        category: 'FSM',
        message: 'strategy-engine.order-blocked',
      }),
    );
    expect(safetyRegistry.get(1).getSnapshot().master).toBe(true);
    expect(safetyRegistry.get(1).getSnapshot().errorLock.active).toBe(false);
  });

  it('active cycle이 없으면 추적 종목이 없다', () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 1,
      buyPrice: 70_000,
      qty: 10,
      amountKrw: 700_000,
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

  it('상승시 해당 차수 sellRule로 익절 주문을 생성한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 2,
      buyPrice: 68_000,
      qty: 10,
      amountKrw: 680_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    setDefaultProfile(strategyRepo);
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
      price: 71_400,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 1,
      accumVolume: 1,
      open: 71_400,
      high: 71_400,
      low: 71_400,
      bestAsk: 71_400,
      bestBid: 71_400,
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

  it('자동매도 ON 저장 직후 최신 tick으로 즉시 익절 주문을 평가한다', async () => {
    const { bus, lotsRepo, safetyRegistry, strategyRepo } = setup();
    lotsRepo.insertLot({
      accountId: 1,
      pdno: '005930',
      nth: 2,
      buyPrice: 68_000,
      qty: 10,
      amountKrw: 680_000,
      status: 'OPEN',
      boughtAt: new Date(),
    });
    strategyRepo.setActive(1, '005930', {
      version: 2,
      maxStages: 3,
      ...createStrategyRules(3, {
        amountKrw: 700_000,
        dropPct: 0.03,
        profitPct: 0.05,
      }),
      autoBuyEnabled: false,
      autoBuyOrderType: 'LIMIT',
      autoSellEnabled: false,
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

    emitSamsungTick(bus, 71_400);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeOrder).not.toHaveBeenCalled();

    strategyRepo.setActive(1, '005930', {
      version: 2,
      maxStages: 3,
      ...createStrategyRules(3, {
        amountKrw: 700_000,
        dropPct: 0.03,
        profitPct: 0.05,
      }),
      autoBuyEnabled: false,
      autoBuyOrderType: 'LIMIT',
      autoSellEnabled: true,
      autoSellOrderType: 'LIMIT',
    });

    expect(engine.evaluateLatest('005930')).toBe(true);
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

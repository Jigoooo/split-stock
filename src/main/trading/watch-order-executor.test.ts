import { type DailyExecution, makeBrokerError } from '@shared/contracts';
import { sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { FakeBrokerAdapter } from '../brokers/__tests__/fake-broker-adapter';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { lots, orders } from '../db/schema';
import { SettingsRepo } from '../db/settings-repo';
import { SafetyStateRegistry } from '../safety/safety-state';
import { LotsRepo } from './lots-repo';
import { StockMasterRepo } from './stock-master-repo';
import { StrategyRepo } from './strategy-repo';
import type { WatchOrder } from './watch-engine';
import {
  executeStrategyOrder,
  executeWatchOrder,
  type StrategyOrderError,
  type WatchOrderExecutorDeps,
} from './watch-order-executor';

function setupDeps(
  broker: FakeBrokerAdapter,
): WatchOrderExecutorDeps & { db: ReturnType<typeof createTestDb> } {
  const db = createTestDb();
  bootstrapSchema(db);
  const logger = { log: vi.fn() };
  const settingsRepo = new SettingsRepo(db);
  const stockMasterRepo = new StockMasterRepo(db);
  const lotsRepo = new LotsRepo(db, stockMasterRepo);
  const strategyRepo = new StrategyRepo(settingsRepo, logger as never);
  const safetyRegistry = new SafetyStateRegistry({ logger: logger as never });
  safetyRegistry.get(1).setMaster(true);
  return {
    db,
    settingsRepo,
    getBrokerForAccount: () => broker,
    safetyRegistry,
    pendingOrderWatcher: null,
    logger: logger as never,
    lotsRepo,
    strategyRepo,
  };
}

function insertOpenLot(
  deps: WatchOrderExecutorDeps,
  input: { nth?: number; pdno?: string; qty?: number } = {},
): number {
  const inserted = deps.lotsRepo.insertLot({
    accountId: 1,
    amountKrw: 338_000,
    boughtAt: new Date('2026-04-29T00:00:00.000Z'),
    buyPrice: 67_600,
    nth: input.nth ?? 1,
    pdno: input.pdno ?? '005930',
    qty: input.qty ?? 5,
    status: 'OPEN',
  });
  if (inserted.isErr()) throw new Error(`lot insert failed: ${inserted.error.kind}`);
  return inserted.value;
}

function watchOrder(overrides: Partial<WatchOrder> = {}): WatchOrder {
  const now = new Date('2026-04-29T00:00:00.000Z');
  return {
    accountId: 1,
    amountKrw: null,
    comparator: 'GTE',
    createdAt: now,
    executedAt: null,
    expiresAt: null,
    id: 1,
    lastFailureReason: null,
    metadata: null,
    nth: 1,
    orderType: 'LIMIT',
    pdno: '005930',
    qty: 5,
    qtyOrAmountMode: 'QTY',
    side: 'SELL',
    source: 'CUSTOM',
    sourceRefId: null,
    status: 'WATCHING',
    targetPrice: 70_000,
    updatedAt: now,
    ...overrides,
  };
}

describe('executeStrategyOrder', () => {
  it('broker 주문 실패의 구조화된 error kind 를 보존한다', async () => {
    const broker = new FakeBrokerAdapter();
    const brokerError = makeBrokerError({
      brokerId: 'KIS',
      kind: 'VALIDATION',
      msg: '주문 수량이 유효하지 않습니다.',
    });
    vi.spyOn(broker, 'placeOrder').mockResolvedValue(err(brokerError));
    const deps = setupDeps(broker);

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 67_800,
        qty: 10,
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    ).rejects.toMatchObject({
      brokerId: 'KIS',
      kind: 'VALIDATION',
      message: '주문 실패: VALIDATION - 주문 수량이 유효하지 않습니다.',
      nth: 1,
      pdno: '005930',
      side: 'BUY',
    } satisfies Partial<StrategyOrderError>);
  });

  it('NETWORK 실패 후 broker 조회에서 같은 주문을 찾으면 중복 주문 없이 로컬 주문으로 연결한다', async () => {
    const broker = new FakeBrokerAdapter();
    vi.spyOn(broker, 'placeOrder').mockResolvedValue(
      err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'NETWORK',
          msg: 'timeout after submit',
        }),
      ),
    );
    const remoteOrder: DailyExecution = {
      avgFillPrice: 0,
      brokerOrderId: '9001',
      brokerOrgNo: '01790',
      cancelled: false,
      name: '삼성전자',
      orderPrice: 67_800,
      orderQty: 10,
      orderedAt: '093000',
      rejectedQty: 0,
      remainingQty: 10,
      side: 'BUY',
      symbol: '005930',
      totalFilledQty: 0,
    };
    vi.spyOn(broker, 'listDailyExecutions').mockImplementation(async (params) =>
      ok(params.filledOnly === true ? [remoteOrder] : []),
    );
    const deps = setupDeps(broker);

    const result = await executeStrategyOrder(deps, {
      accountId: 1,
      division: 'LIMIT',
      nth: 1,
      pdno: '005930',
      price: 67_800,
      qty: 10,
      side: 'BUY',
      triggerReason: 'DROP_BUY',
    });

    expect(result).toEqual({ brokerOrderId: '9001', reconciled: true });
    expect(broker.placeOrder).toHaveBeenCalledTimes(1);
    expect(broker.listDailyExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        filledOnly: false,
        side: 'BUY',
        symbol: '005930',
      }),
    );
    expect(broker.listDailyExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        filledOnly: true,
        side: 'BUY',
        symbol: '005930',
      }),
    );
    expect(deps.db.select().from(orders).all()).toEqual([
      expect.objectContaining({
        accountId: 1,
        odno: '9001',
        orgNo: '01790',
        pdno: '005930',
        side: 'BUY',
        status: 'PENDING',
      }),
    ]);
  });

  it('NETWORK 복구 주문의 orgNo를 보존해 로컬 기록 실패 시 broker 취소를 요청한다', async () => {
    const broker = new FakeBrokerAdapter();
    vi.spyOn(broker, 'placeOrder').mockResolvedValue(
      err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'NETWORK',
          msg: 'timeout after submit',
        }),
      ),
    );
    const remoteOrder: DailyExecution = {
      avgFillPrice: 0,
      brokerOrderId: '9004',
      brokerOrgNo: '01790',
      cancelled: false,
      name: '삼성전자',
      orderPrice: 67_800,
      orderQty: 10,
      orderedAt: '093003',
      rejectedQty: 0,
      remainingQty: 10,
      side: 'BUY',
      symbol: '005930',
      totalFilledQty: 0,
    };
    vi.spyOn(broker, 'listDailyExecutions').mockResolvedValue(ok([remoteOrder]));
    const deps = setupDeps(broker);
    deps.db.run(sql.raw('DROP TABLE orders'));

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 67_800,
        qty: 10,
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    ).rejects.toThrow();

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '9004',
        brokerOrgNo: '01790',
        symbol: '005930',
      }),
    ]);
    expect(deps.db.select().from(lots).all()).toEqual([]);
  });

  it('로컬 기록 실패 후 broker 취소 호출이 throw 되어도 원래 실패를 보존한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    vi.spyOn(broker, 'cancelOrder').mockRejectedValue(new Error('cancel transport failed'));
    const deps = setupDeps(broker);
    deps.db.run(sql.raw('DROP TABLE orders'));

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 67_800,
        qty: 10,
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    ).rejects.toThrow('전략 주문 로컬 기록 실패');

    expect(broker.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        symbol: '005930',
      }),
    );
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'order.local-failure.cancel-failed' }),
    );
  });

  it('reconcileOnly 재시도는 새 주문을 내지 않고 주문 조회만 수행한다', async () => {
    const broker = new FakeBrokerAdapter();
    const placeOrder = vi.spyOn(broker, 'placeOrder');
    const remoteOrder: DailyExecution = {
      avgFillPrice: 0,
      brokerOrderId: '9002',
      cancelled: false,
      name: '삼성전자',
      orderPrice: 67_800,
      orderQty: 10,
      orderedAt: '093001',
      rejectedQty: 0,
      remainingQty: 10,
      side: 'BUY',
      symbol: '005930',
      totalFilledQty: 0,
    };
    vi.spyOn(broker, 'listDailyExecutions').mockResolvedValue(ok([remoteOrder]));
    const deps = setupDeps(broker);

    const result = await executeStrategyOrder(deps, {
      accountId: 1,
      division: 'LIMIT',
      nth: 1,
      pdno: '005930',
      price: 67_800,
      qty: 10,
      reconcileOnly: true,
      side: 'BUY',
      triggerReason: 'DROP_BUY',
    });

    expect(result).toEqual({ brokerOrderId: '9002', reconciled: true });
    expect(placeOrder).not.toHaveBeenCalled();
    expect(broker.listDailyExecutions).toHaveBeenCalledTimes(2);
  });

  it('reconcileOnly 복구 후 차수 예약 실패 시에도 broker 취소를 요청한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIS' });
    const placeOrder = vi.spyOn(broker, 'placeOrder');
    const remoteOrder: DailyExecution = {
      avgFillPrice: 0,
      brokerOrderId: '9005',
      brokerOrgNo: '01790',
      cancelled: false,
      name: '삼성전자',
      orderPrice: 67_800,
      orderQty: 10,
      orderedAt: '093004',
      rejectedQty: 0,
      remainingQty: 10,
      side: 'BUY',
      symbol: '005930',
      totalFilledQty: 0,
    };
    vi.spyOn(broker, 'listDailyExecutions').mockResolvedValue(ok([remoteOrder]));
    const deps = setupDeps(broker);
    deps.db.run(sql.raw('DROP TABLE lots'));

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 67_800,
        qty: 10,
        reconcileOnly: true,
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    ).rejects.toThrow('자동매수 차수 예약 실패');

    expect(placeOrder).not.toHaveBeenCalled();
    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '9005',
        brokerOrgNo: '01790',
        symbol: '005930',
      }),
    ]);
  });

  it('reconcileOnly 는 안전/자동매수 가드 전에 주문 조회만 수행한다', async () => {
    const broker = new FakeBrokerAdapter();
    const placeOrder = vi.spyOn(broker, 'placeOrder');
    const remoteOrder: DailyExecution = {
      avgFillPrice: 0,
      brokerOrderId: '9003',
      cancelled: false,
      name: '삼성전자',
      orderPrice: 67_800,
      orderQty: 10,
      orderedAt: '093002',
      rejectedQty: 0,
      remainingQty: 10,
      side: 'BUY',
      symbol: '005930',
      totalFilledQty: 0,
    };
    vi.spyOn(broker, 'listDailyExecutions').mockResolvedValue(ok([remoteOrder]));
    const deps = setupDeps(broker);
    deps.safetyRegistry.get(1).setMaster(false);
    deps.autoBuyGuard = {
      assertAutoBuyAllowed: vi.fn(() => {
        throw new Error('auto buy guard should not run during reconcileOnly');
      }),
    };

    const result = await executeStrategyOrder(deps, {
      accountId: 1,
      division: 'LIMIT',
      nth: 1,
      pdno: '005930',
      price: 67_800,
      qty: 10,
      reconcileOnly: true,
      side: 'BUY',
      triggerReason: 'DROP_BUY',
    });

    expect(result).toEqual({ brokerOrderId: '9003', reconciled: true });
    expect(placeOrder).not.toHaveBeenCalled();
    expect(deps.autoBuyGuard.assertAutoBuyAllowed).not.toHaveBeenCalled();
  });

  it('자동매도는 OPEN 차수를 먼저 SELLING으로 잠그지 못하면 broker 주문을 내지 않는다', async () => {
    const broker = new FakeBrokerAdapter();
    const deps = setupDeps(broker);

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 70_000,
        qty: 5,
        side: 'SELL',
        triggerReason: 'PROFIT_SELL',
      }),
    ).rejects.toThrow('자동매도 차수 예약 실패');

    expect(broker.callCount.placeOrder).toBe(0);
    expect(deps.db.select().from(orders).all()).toEqual([]);
  });

  it('자동매도 broker 실패 시 선잠금한 SELLING 차수를 OPEN으로 되돌린다', async () => {
    const broker = new FakeBrokerAdapter();
    const placeOrder = vi.spyOn(broker, 'placeOrder').mockResolvedValue(
      err(
        makeBrokerError({
          brokerId: 'KIS',
          kind: 'BUSINESS',
          msg: '주문 거부',
        }),
      ),
    );
    const deps = setupDeps(broker);
    const lotId = insertOpenLot(deps);

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 70_000,
        qty: 5,
        side: 'SELL',
        triggerReason: 'PROFIT_SELL',
      }),
    ).rejects.toMatchObject({ kind: 'BUSINESS' });

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(deps.db.select().from(lots).all()).toEqual([
      expect.objectContaining({ id: lotId, status: 'OPEN' }),
    ]);
  });

  it('자동매도 broker 접수 후 로컬 주문 기록 실패 시 취소를 요청하고 차수를 되돌린다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    const deps = setupDeps(broker);
    const lotId = insertOpenLot(deps);
    deps.db.run(sql.raw('DROP TABLE orders'));

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'LIMIT',
        nth: 1,
        pdno: '005930',
        price: 70_000,
        qty: 5,
        side: 'SELL',
        triggerReason: 'PROFIT_SELL',
      }),
    ).rejects.toThrow('전략 주문 로컬 기록 실패');

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        symbol: '005930',
      }),
    ]);
    expect(deps.db.select().from(lots).all()).toEqual([
      expect.objectContaining({ id: lotId, status: 'OPEN' }),
    ]);
  });

  it('자동매수 broker 접수 후 로컬 주문 기록 실패 시 생성한 BUYING 차수를 제거한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    const deps = setupDeps(broker);
    deps.db.run(sql.raw('DROP TABLE orders'));

    await expect(
      executeStrategyOrder(deps, {
        accountId: 1,
        division: 'MARKET',
        nth: 1,
        pdno: '005930',
        price: 0,
        qty: 5,
        side: 'BUY',
        triggerReason: 'DROP_BUY',
      }),
    ).rejects.toThrow('전략 주문 로컬 기록 실패');

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        kind: 'MARKET',
        symbol: '005930',
      }),
    ]);
    expect(deps.db.select().from(lots).all()).toEqual([]);
  });
});

describe('executeWatchOrder', () => {
  it('자동감시매도는 OPEN 차수 예약 전에는 broker 주문을 내지 않는다', async () => {
    const broker = new FakeBrokerAdapter();
    const deps = setupDeps(broker);

    await expect(executeWatchOrder(deps, watchOrder(), 70_000)).rejects.toThrow(
      '자동매도 차수 예약 실패',
    );

    expect(broker.callCount.placeOrder).toBe(0);
    expect(deps.db.select().from(orders).all()).toEqual([]);
  });

  it('자동감시매도 broker 접수 후 로컬 기록 실패 시 취소를 요청하고 차수를 되돌린다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    const deps = setupDeps(broker);
    const lotId = insertOpenLot(deps);
    deps.db.run(sql.raw('DROP TABLE orders'));

    await expect(executeWatchOrder(deps, watchOrder(), 70_000)).rejects.toThrow(
      '자동감시 주문 로컬 기록 실패',
    );

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        symbol: '005930',
      }),
    ]);
    expect(deps.db.select().from(lots).all()).toEqual([
      expect.objectContaining({ id: lotId, status: 'OPEN' }),
    ]);
  });
});

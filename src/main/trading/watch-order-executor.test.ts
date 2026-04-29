import { type DailyExecution, makeBrokerError } from '@shared/contracts';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { FakeBrokerAdapter } from '../brokers/__tests__/fake-broker-adapter';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { orders } from '../db/schema';
import { SettingsRepo } from '../db/settings-repo';
import { SafetyStateRegistry } from '../safety/safety-state';
import { LotsRepo } from './lots-repo';
import { StockMasterRepo } from './stock-master-repo';
import { StrategyRepo } from './strategy-repo';
import {
  executeStrategyOrder,
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
        pdno: '005930',
        side: 'BUY',
        status: 'PENDING',
      }),
    ]);
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
});

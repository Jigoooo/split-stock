import {
  type BrokerError,
  makeBrokerError,
  type OrderAck,
  type OrderIntent,
} from '@shared/contracts';
import { eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { FakeBrokerAdapter } from '../../brokers/__tests__/fake-broker-adapter';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { lots, orders } from '../../db/schema';
import { SettingsRepo } from '../../db/settings-repo';
import { LotsRepo } from '../../trading/lots-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { orderRouter } from './order-router';

const createCaller = t.createCallerFactory(orderRouter);

function createOrderCtx(broker = new FakeBrokerAdapter({ startOrderId: 9000 })) {
  const db = createTestDb();
  bootstrapSchema(db);
  const trigger = vi.fn(() => ({ started: true }));
  const ctx = {
    currentEnv: 'MOCK',
    db,
    settingsRepo: new SettingsRepo(db),
    lotsRepo: new LotsRepo(db),
    logger: { log: vi.fn() },
    pendingOrderWatcher: null,
    currentStateSync: { trigger },
    brokerForAccount: () => broker,
    safetyRegistry: { get: () => ({ canTrade: () => true }) },
  } as unknown as Context;
  return { ctx, db, broker, trigger };
}

describe('orderRouter.placeCash', () => {
  it('시장가 수동매수는 broker와 로컬 주문 가격을 0 sentinel로 기록한다', async () => {
    const { ctx, db, broker, trigger } = createOrderCtx();
    const caller = createCaller(ctx);

    const ack = await caller.placeCash({
      accountId: 1,
      side: 'BUY',
      pdno: '005930',
      qty: 2,
      price: 70100,
      division: 'MARKET',
    });

    expect(ack.odno).toBe('9000');
    expect(broker.placedOrders[0]).toMatchObject({
      side: 'BUY',
      symbol: '005930',
      qty: 2,
      price: 0,
      kind: 'MARKET',
    });
    expect(db.select().from(orders).get()).toMatchObject({
      pdno: '005930',
      side: 'BUY',
      division: 'MARKET',
      price: 0,
      status: 'PENDING',
    });
    expect(trigger).toHaveBeenCalledWith('trade-event', {
      accountId: 1,
      brokerOrderId: '9000',
      symbol: '005930',
    });
  });

  it('수동매수는 broker 호출 전에 BUYING 차수를 예약하고 broker 실패 시 삭제한다', async () => {
    const broker = new FakeBrokerAdapter();
    const { ctx, db } = createOrderCtx(broker);
    let statusDuringBrokerCall: string | undefined;
    const placeOrder = vi.spyOn(broker, 'placeOrder').mockImplementation(async () => {
      statusDuringBrokerCall = db.select({ status: lots.status }).from(lots).get()?.status;
      return err(makeBrokerError({ brokerId: 'KIS', kind: 'NETWORK', msg: 'down' }));
    });
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'BUY',
        pdno: '005930',
        qty: 2,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(statusDuringBrokerCall).toBe('BUYING');
    expect(db.select().from(lots).all()).toEqual([]);
  });

  it('수동매수 차수 예약 실패 시 broker 주문을 내지 않는다', async () => {
    const { ctx, db, broker } = createOrderCtx();
    db.run(sql.raw('DROP TABLE lots'));
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'BUY',
        pdno: '005930',
        qty: 2,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '매수 차수 예약 실패: 로컬 BUYING 차수를 생성하지 못했습니다.',
    });

    expect(broker.callCount.placeOrder).toBe(0);
  });

  it('수동매수 broker 접수 후 로컬 주문 기록 실패 시 취소를 요청하고 BUYING 차수를 삭제한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    const { ctx, db } = createOrderCtx(broker);
    db.run(sql.raw('DROP TABLE orders'));
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'BUY',
        pdno: '005930',
        qty: 2,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        symbol: '005930',
      }),
    ]);
    expect(db.select().from(lots).all()).toEqual([]);
  });

  it('수동매수 로컬 기록 실패 후 broker 취소가 throw 되어도 원래 실패를 보존한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    vi.spyOn(broker, 'cancelOrder').mockRejectedValue(new Error('cancel transport failed'));
    const { ctx, db } = createOrderCtx(broker);
    db.run(sql.raw('DROP TABLE orders'));
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'BUY',
        pdno: '005930',
        qty: 2,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: expect.stringContaining('주문 로컬 기록 실패'),
    });

    expect(broker.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        all: true,
        brokerOrderId: '1000',
        symbol: '005930',
      }),
    );
    expect(ctx.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'order.local-failure.cancel-failed' }),
    );
  });

  it('수동매수 로컬 기록 실패 후 롤백이 실패해도 broker 취소를 먼저 보장한다', async () => {
    const broker = new FakeBrokerAdapter({ brokerId: 'KIWOOM' });
    const { ctx, db } = createOrderCtx(broker);
    db.run(sql.raw('DROP TABLE orders'));
    vi.spyOn(broker, 'placeOrder').mockImplementation(async () => {
      db.run(sql.raw('DROP TABLE lots'));
      return ok({ brokerOrderId: '9000', brokerOrgNo: '00001' });
    });
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'BUY',
        pdno: '005930',
        qty: 2,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(broker.cancelledOrders).toEqual([
      expect.objectContaining({
        all: true,
        brokerOrderId: '9000',
        symbol: '005930',
      }),
    ]);
    expect(ctx.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'order.local-reservation.rollback-failed' }),
    );
  });

  it('수동매도는 broker 호출 전에 단일 OPEN 차수 보유를 검증한다', async () => {
    const { ctx, broker } = createOrderCtx();
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'SELL',
        pdno: '005930',
        qty: 1,
        price: 70100,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(broker.callCount.placeOrder).toBe(0);
  });

  it('수동매도 성공 시 가장 높은 OPEN 차수만 SELLING으로 잠근다', async () => {
    const { ctx, db, broker } = createOrderCtx();
    const now = new Date('2026-04-22T09:00:00+09:00');
    db.insert(lots)
      .values([
        {
          accountId: 1,
          pdno: '005930',
          nth: 1,
          buyPrice: 69000,
          qty: 2,
          amountKrw: 138000,
          status: 'OPEN',
          boughtAt: now,
        },
        {
          accountId: 1,
          pdno: '005930',
          nth: 2,
          buyPrice: 70000,
          qty: 2,
          amountKrw: 140000,
          status: 'OPEN',
          boughtAt: now,
        },
      ])
      .run();
    const caller = createCaller(ctx);

    await caller.placeCash({
      accountId: 1,
      side: 'SELL',
      pdno: '005930',
      qty: 2,
      price: 71000,
      division: 'LIMIT',
    });

    expect(broker.placedOrders[0]).toMatchObject({
      side: 'SELL',
      symbol: '005930',
      qty: 2,
      price: 71000,
      kind: 'LIMIT',
    });
    expect(
      db.select({ nth: lots.nth, status: lots.status }).from(lots).orderBy(lots.nth).all(),
    ).toEqual([
      { nth: 1, status: 'OPEN' },
      { nth: 2, status: 'SELLING' },
    ]);
    expect(db.select().from(orders).get()).toMatchObject({
      side: 'SELL',
      lotId: 2,
      status: 'PENDING',
    });
  });

  it('수동매도는 broker 호출 전에 차수를 선점하고 broker 실패 시 OPEN으로 되돌린다', async () => {
    const broker = new FakeBrokerAdapter();
    const { ctx, db } = createOrderCtx(broker);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 70000,
        qty: 2,
        amountKrw: 140000,
        status: 'OPEN',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();
    let statusDuringBrokerCall: string | undefined;
    broker.placeOrder = async (_intent: OrderIntent): Promise<Result<OrderAck, BrokerError>> => {
      statusDuringBrokerCall = db
        .select({ status: lots.status })
        .from(lots)
        .where(eq(lots.id, lot.id))
        .get()?.status;
      return err(makeBrokerError({ brokerId: 'KIS', kind: 'NETWORK', msg: 'down' }));
    };
    const caller = createCaller(ctx);

    await expect(
      caller.placeCash({
        accountId: 1,
        side: 'SELL',
        pdno: '005930',
        qty: 2,
        price: 71000,
        division: 'LIMIT',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(statusDuringBrokerCall).toBe('SELLING');
    expect(db.select().from(lots).where(eq(lots.id, lot.id)).get()).toMatchObject({
      status: 'OPEN',
    });
  });
});

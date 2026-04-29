import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { BrokerPort } from '../brokers/ports/broker-port';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { lots, orders, trades } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';
import {
  ManualOrderReconciler,
  resolveManualOrderDecision,
  resolveServerPendingAbsenceDecision,
} from './manual-order-reconciler';

describe('resolveManualOrderDecision', () => {
  it('총체결수량이 주문수량과 같으면 FILLED로 전이하고 delta를 계산한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 70000,
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 10,
        remainingQty: 0,
        avgFillPrice: 69900,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'FILLED',
      totalFilledQty: 10,
      deltaFilledQty: 10,
      remainingQty: 0,
      executionPrice: 69900,
    });
  });

  it('이미 일부 체결된 주문은 증가분만 delta로 계산하고 PARTIAL 유지한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PARTIAL',
      orderQty: 10,
      localFilledQty: 2,
      localPrice: 70000,
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 5,
        remainingQty: 5,
        avgFillPrice: 70100,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'PARTIAL',
      totalFilledQty: 5,
      deltaFilledQty: 3,
      remainingQty: 5,
      executionPrice: 70100,
    });
  });

  it('체결 없이 취소된 주문은 CANCELLED로 전이한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 70000,
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 0,
        remainingQty: 10,
        avgFillPrice: 0,
        cancelled: true,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: 10,
      executionPrice: 70000,
    });
  });

  it('일부 체결 후 취소된 주문은 CANCELLED로 전이한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PARTIAL',
      orderQty: 10,
      localFilledQty: 2,
      localPrice: 70000,
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'SELL',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 4,
        remainingQty: 6,
        avgFillPrice: 70100,
        cancelled: true,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'CANCELLED',
      totalFilledQty: 4,
      deltaFilledQty: 2,
      remainingQty: 6,
      executionPrice: 70100,
    });
  });

  it('서버 미체결 목록에서 사라진 오래된 로컬 PENDING은 CANCELLED로 정리한다', () => {
    const decision = resolveServerPendingAbsenceDecision({
      localFilledQty: 0,
      orderQty: 10,
      localPrice: 70000,
      context: {
        serverPendingPresent: false,
        now: new Date('2026-04-22T09:00:20+09:00'),
        placedAt: new Date('2026-04-22T09:00:00+09:00'),
        graceMs: 10_000,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: 10,
      executionPrice: 70000,
    });
  });

  it('유예 시간 안이면 서버 pending 목록에 아직 없어도 정리하지 않는다', () => {
    const decision = resolveServerPendingAbsenceDecision({
      localFilledQty: 0,
      orderQty: 10,
      localPrice: 70000,
      context: {
        serverPendingPresent: false,
        now: new Date('2026-04-22T09:00:05+09:00'),
        placedAt: new Date('2026-04-22T09:00:00+09:00'),
        graceMs: 10_000,
      },
    });

    expect(decision).toBeNull();
  });
});

describe('ManualOrderReconciler lot reconciliation', () => {
  it('부분 매도 후 취소되면 남은 수량만 OPEN으로 복원한다', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        accountId: 1,
        pdno: '005930',
        nth: 1,
        buyPrice: 10000,
        qty: 10,
        amountKrw: 100000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();
    const order = db
      .insert(orders)
      .values({
        accountId: 1,
        lotId: lot.id,
        odno: 'ORD-1',
        orgNo: 'ORG-1',
        pdno: '005930',
        side: 'SELL',
        division: 'LIMIT',
        qty: 10,
        price: 11000,
        status: 'PARTIAL',
        placedAt: now,
        filledAt: now,
      })
      .returning({ id: orders.id })
      .get();
    db.insert(trades)
      .values({
        orderId: order.id,
        qty: 2,
        price: 11000,
        executedAt: now,
      })
      .run();

    const broker = {
      brokerId: 'KIS',
      env: 'MOCK',
      listDailyExecutions: async () => ({
        isOk: () => true,
        isErr: () => false,
        value: [
          {
            brokerOrderId: 'ORD-1',
            symbol: '005930',
            name: '삼성전자',
            side: 'SELL',
            orderQty: 10,
            orderPrice: 11000,
            orderedAt: '090000',
            totalFilledQty: 4,
            remainingQty: 6,
            avgFillPrice: 11050,
            cancelled: true,
            rejectedQty: 0,
          },
        ],
      }),
    } as unknown as BrokerPort;
    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: () => broker,
      logger: { log: () => undefined } satisfies EventLogger,
      onTradeExecution: () => undefined,
      stalePendingGraceMs: 0,
    });

    await reconciler.poll();

    const updatedLot = db.select().from(lots).where(eq(lots.id, lot.id)).get();
    const updatedOrder = db.select().from(orders).where(eq(orders.id, order.id)).get();
    const updatedTrades = db.select().from(trades).where(eq(trades.orderId, order.id)).all();

    expect(updatedLot).toMatchObject({
      status: 'OPEN',
      qty: 6,
      amountKrw: 60000,
      soldAt: null,
      sellPrice: null,
    });
    expect(updatedOrder).toMatchObject({ status: 'CANCELLED' });
    expect(updatedTrades.map((trade) => trade.qty)).toEqual([2, 2]);
  });
});

import { BROKERS } from '@shared/contracts';
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

  it('시장가 체결은 broker 평균체결가가 없으면 0원 체결로 기록하지 않고 보류한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 0,
      division: 'MARKET',
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 0,
        orderedAt: '093000',
        totalFilledQty: 10,
        remainingQty: 0,
        avgFillPrice: 0,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toBeNull();
  });

  it('시장가 체결은 broker 평균체결가가 있을 때만 해당 가격으로 확정한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 0,
      division: 'MARKET',
      remote: {
        brokerOrderId: '1',
        symbol: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 0,
        orderedAt: '093000',
        totalFilledQty: 10,
        remainingQty: 0,
        avgFillPrice: 70100,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toMatchObject({
      nextStatus: 'FILLED',
      executionPrice: 70100,
      totalFilledQty: 10,
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

  it('시장가 부분체결 로컬 기록만 있는 주문은 평균 체결가 없으면 부재 정리를 보류한다', () => {
    const decision = resolveServerPendingAbsenceDecision({
      localFilledQty: 2,
      orderQty: 10,
      localPrice: 0,
      division: 'MARKET',
      context: {
        serverPendingPresent: false,
        now: new Date('2026-04-22T09:00:20+09:00'),
        placedAt: new Date('2026-04-22T09:00:00+09:00'),
        graceMs: 10_000,
      },
    });

    expect(decision).toBeNull();
  });
});

describe('ManualOrderReconciler lot reconciliation', () => {
  it('시장가 원격 체결에 평균가가 없으면 stale 부재 fallback으로 CANCELLED 처리하지 않는다', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const order = db
      .insert(orders)
      .values({
        accountId: 1,
        lotId: null,
        odno: 'ORD-MARKET',
        orgNo: 'ORG-1',
        pdno: '005930',
        side: 'BUY',
        division: 'MARKET',
        qty: 2,
        price: 0,
        status: 'PENDING',
        placedAt: now,
      })
      .returning({ id: orders.id })
      .get();

    const broker = {
      brokerId: 'KIS',
      env: 'MOCK',
      listDailyExecutions: async () => ({
        isOk: () => true,
        isErr: () => false,
        value: [
          {
            brokerOrderId: 'ORD-MARKET',
            symbol: '005930',
            name: '삼성전자',
            side: 'BUY',
            orderQty: 2,
            orderPrice: 0,
            orderedAt: '090000',
            totalFilledQty: 2,
            remainingQty: 0,
            avgFillPrice: 0,
            cancelled: false,
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

    expect(db.select().from(orders).where(eq(orders.id, order.id)).get()).toMatchObject({
      status: 'PENDING',
    });
    expect(db.select().from(trades).where(eq(trades.orderId, order.id)).all()).toEqual([]);
  });

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

  // B6 regression: onTradeExecution 발화 시점에 lot 이 이미 SOLD 상태여야 한다.
  // BoosterService.handleTradeExecution 가 snapshot 읽을 때 hasActiveCycle=false 가 되어야
  // booster register 가 skip 되지 않음을 보장하는 테스트.
  it('B6 — SELL FILLED 처리 시 onTradeExecution 호출 전에 lot 이 SOLD 로 전이된다', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');
    const lot = db
      .insert(lots)
      .values({
        accountId: 1,
        pdno: '005930',
        nth: 2,
        buyPrice: 10000,
        qty: 10,
        amountKrw: 100000,
        status: 'SELLING',
        boughtAt: now,
      })
      .returning({ id: lots.id })
      .get();

    db.insert(orders)
      .values({
        accountId: 1,
        lotId: lot.id,
        odno: 'ORD-SELL-1',
        orgNo: 'ORG-S-1',
        pdno: '005930',
        side: 'SELL',
        division: 'LIMIT',
        qty: 10,
        price: 11000,
        status: 'PENDING',
        placedAt: now,
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
            brokerOrderId: 'ORD-SELL-1',
            symbol: '005930',
            name: '삼성전자',
            side: 'SELL',
            orderQty: 10,
            orderPrice: 11000,
            orderedAt: '090000',
            totalFilledQty: 10,
            remainingQty: 0,
            avgFillPrice: 11000,
            cancelled: false,
            rejectedQty: 0,
          },
        ],
      }),
    } as unknown as BrokerPort;

    // onTradeExecution 발화 시점의 lot status 를 캡처한다.
    let lotStatusAtCallback: string | undefined;
    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: () => broker,
      logger: { log: () => undefined } satisfies EventLogger,
      onTradeExecution: (evt) => {
        if (evt.lotId === lot.id) {
          const row = db
            .select({ status: lots.status })
            .from(lots)
            .where(eq(lots.id, lot.id))
            .get();
          lotStatusAtCallback = row?.status;
        }
      },
      stalePendingGraceMs: 0,
    });

    await reconciler.poll();

    // B6 fix 검증: onTradeExecution 콜백 시점에 lot 은 이미 SOLD 여야 한다.
    expect(lotStatusAtCallback).toBe('SOLD');
    // 최종 상태도 SOLD 확인.
    const finalLot = db.select().from(lots).where(eq(lots.id, lot.id)).get();
    expect(finalLot).toMatchObject({ status: 'SOLD' });
  });

  // Phase 6 multi-broker — KIS+KIWOOM mixed pending 모두 row.broker 기반 dispatch.
  it('도메스틱 broker 별 PENDING row 가 각자의 BrokerPort 로 dispatch 된다', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');

    const kisOrder = db
      .insert(orders)
      .values({
        broker: BROKERS.KIS,
        accountId: 1,
        odno: 'KIS-1',
        pdno: '005930',
        side: 'BUY',
        division: 'LIMIT',
        qty: 10,
        price: 70000,
        status: 'PENDING',
        placedAt: now,
      })
      .returning({ id: orders.id })
      .get();

    const kiwoomOrder = db
      .insert(orders)
      .values({
        broker: BROKERS.KIWOOM,
        accountId: 2,
        odno: 'KW-1',
        pdno: '005930',
        side: 'BUY',
        division: 'LIMIT',
        qty: 5,
        price: 70000,
        status: 'PENDING',
        placedAt: now,
      })
      .returning({ id: orders.id })
      .get();

    const kisBroker = {
      brokerId: BROKERS.KIS,
      env: 'MOCK',
      listDailyExecutions: async () => ({
        isOk: () => true,
        isErr: () => false,
        value: [
          {
            brokerOrderId: 'KIS-1',
            symbol: '005930',
            name: '삼성전자',
            side: 'BUY',
            orderQty: 10,
            orderPrice: 70000,
            orderedAt: '090000',
            totalFilledQty: 10,
            remainingQty: 0,
            avgFillPrice: 70000,
            cancelled: false,
            rejectedQty: 0,
          },
        ],
      }),
    } as unknown as BrokerPort;

    const kiwoomBroker = {
      brokerId: BROKERS.KIWOOM,
      env: 'MOCK',
      listDailyExecutions: async () => ({
        isOk: () => true,
        isErr: () => false,
        value: [
          {
            brokerOrderId: 'KW-1',
            symbol: '005930',
            name: '삼성전자',
            side: 'BUY',
            orderQty: 5,
            orderPrice: 70000,
            orderedAt: '090000',
            totalFilledQty: 5,
            remainingQty: 0,
            avgFillPrice: 71000,
            cancelled: false,
            rejectedQty: 0,
          },
        ],
      }),
    } as unknown as BrokerPort;

    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: (accountId) => (accountId === 1 ? kisBroker : kiwoomBroker),
      logger: { log: () => undefined } satisfies EventLogger,
      onTradeExecution: () => undefined,
      stalePendingGraceMs: 0,
    });

    await reconciler.poll();

    // KIS row → KIS broker 로 trade insert (row.broker = KIS).
    const kisTrades = db.select().from(trades).where(eq(trades.orderId, kisOrder.id)).all();
    expect(kisTrades).toHaveLength(1);
    expect(kisTrades[0]).toMatchObject({ broker: BROKERS.KIS, qty: 10, price: 70000 });

    // KIWOOM row → KIWOOM broker 로 trade insert. avgFillPrice 71000 사용.
    const kiwoomTrades = db.select().from(trades).where(eq(trades.orderId, kiwoomOrder.id)).all();
    expect(kiwoomTrades).toHaveLength(1);
    expect(kiwoomTrades[0]).toMatchObject({ broker: BROKERS.KIWOOM, qty: 5, price: 71000 });

    // 두 order 모두 FILLED.
    expect(db.select().from(orders).where(eq(orders.id, kisOrder.id)).get()).toMatchObject({
      status: 'FILLED',
    });
    expect(db.select().from(orders).where(eq(orders.id, kiwoomOrder.id)).get()).toMatchObject({
      status: 'FILLED',
    });
  });

  // Phase 6 M1 — orders 테이블에 도메스틱 외 broker 가 잘못 들어가도 무시.
  it('orders broker 화이트리스트 — 도메스틱 외 broker row 는 폴링 대상에서 제외', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const now = new Date('2026-04-22T09:00:00+09:00');

    // 비도메스틱 broker row (방어 테스트용 — 실제로는 orders 에 들어가지 않음).
    db.insert(orders)
      .values({
        broker: 'UPBIT',
        accountId: 1,
        odno: 'UB-1',
        pdno: 'KRW-BTC',
        side: 'BUY',
        division: 'LIMIT',
        qty: 1,
        price: 100000,
        status: 'PENDING',
        placedAt: now,
      })
      .run();

    let getBrokerCalled = false;
    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: () => {
        getBrokerCalled = true;
        return null;
      },
      logger: { log: () => undefined } satisfies EventLogger,
      onTradeExecution: () => undefined,
      stalePendingGraceMs: 0,
    });

    await reconciler.poll();

    // UPBIT row 가 화이트리스트로 걸러져 getBrokerForAccount 가 호출되지 않아야 함.
    expect(getBrokerCalled).toBe(false);
  });

  // Phase 6 M2 — broker null 이 staleBrokerMissingMs 이상 지속되면 CANCELLED 마킹.
  // reconciler 가 시스템 Date.now() 를 사용하므로 placedAt 도 시스템 시각 기준으로 산출.
  it('M2 self-healing — broker null + 24h 경과 PENDING row 는 CANCELLED 로 마킹된다', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const placedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 시스템 시각 기준 25h 전

    const order = db
      .insert(orders)
      .values({
        accountId: 1,
        odno: 'STALE-1',
        pdno: '005930',
        side: 'BUY',
        division: 'LIMIT',
        qty: 10,
        price: 70000,
        status: 'PENDING',
        placedAt,
      })
      .returning({ id: orders.id })
      .get();

    const errorLogs: Array<{ level: string; message: string }> = [];
    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: () => null,
      logger: {
        log: (entry) => {
          errorLogs.push({ level: entry.level, message: entry.message });
        },
      } satisfies EventLogger,
      onTradeExecution: () => undefined,
      stalePendingGraceMs: 0,
      staleBrokerMissingMs: 24 * 60 * 60 * 1000,
    });

    await reconciler.poll();

    expect(db.select().from(orders).where(eq(orders.id, order.id)).get()).toMatchObject({
      status: 'CANCELLED',
    });
    expect(
      errorLogs.some(
        (l) =>
          l.level === 'ERROR' &&
          l.message === 'manual-order-reconciler.broker_missing.stale-cancelled',
      ),
    ).toBe(true);
  });

  it('M2 self-healing — broker null + 24h 미만 PENDING 은 WARN 만, CANCELLED 안 됨', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const placedAt = new Date(Date.now() - 1 * 60 * 60 * 1000); // 시스템 시각 기준 1h 전

    const order = db
      .insert(orders)
      .values({
        accountId: 1,
        odno: 'FRESH-1',
        pdno: '005930',
        side: 'BUY',
        division: 'LIMIT',
        qty: 10,
        price: 70000,
        status: 'PENDING',
        placedAt,
      })
      .returning({ id: orders.id })
      .get();

    const reconciler = new ManualOrderReconciler({
      db,
      getBrokerForAccount: () => null,
      logger: { log: () => undefined } satisfies EventLogger,
      onTradeExecution: () => undefined,
      stalePendingGraceMs: 0,
      staleBrokerMissingMs: 24 * 60 * 60 * 1000,
    });

    await reconciler.poll();

    // 1h 만 경과한 row 는 PENDING 유지.
    expect(db.select().from(orders).where(eq(orders.id, order.id)).get()).toMatchObject({
      status: 'PENDING',
    });
  });
});

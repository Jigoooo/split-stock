import type { Balance, OrderIntent, RealtimeEvent } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { FakeBrokerAdapter } from './fake-broker-adapter';

const baseBalance: Balance = {
  positions: [
    {
      symbol: '005930',
      name: '삼성전자',
      qty: 10,
      avgPrice: 70_000,
      currentPrice: 71_000,
      evalAmount: 710_000,
      pnlAmount: 10_000,
      pnlRate: 1.43,
    },
  ],
  deposit: 1_000_000,
  d2Deposit: 950_000,
  totalEval: 1_710_000,
  estimatedAsset: 1_710_000,
};

describe('FakeBrokerAdapter — BrokerPort conformance', () => {
  it('placeOrder 는 brokerOrderId 를 발급하고 placedOrders 에 기록', async () => {
    const fake = new FakeBrokerAdapter({ startOrderId: 1000 });
    const intent: OrderIntent = {
      side: 'BUY',
      symbol: '005930',
      qty: 1,
      price: 70_000,
      kind: 'LIMIT',
    };
    const r = await fake.placeOrder(intent);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.brokerOrderId).toBe('1000');
    expect(fake.placedOrders).toEqual([intent]);
    expect(fake.callCount.placeOrder).toBe(1);
  });

  it('cancelOrder 는 cancelledOrders 에 기록', async () => {
    const fake = new FakeBrokerAdapter();
    const r = await fake.cancelOrder({ brokerOrderId: '1000', all: true });
    expect(r.isOk()).toBe(true);
    expect(fake.cancelledOrders).toHaveLength(1);
    expect(fake.cancelledOrders[0]?.all).toBe(true);
  });

  it('inquireBalance 는 시드된 잔고를 반환', async () => {
    const fake = new FakeBrokerAdapter({ balance: baseBalance });
    const r = await fake.inquireBalance();
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.positions[0]?.symbol).toBe('005930');
  });

  it('setBalance/setHoldings 로 테스트 도중 변경 가능', async () => {
    const fake = new FakeBrokerAdapter({ balance: baseBalance });
    fake.setHoldings([]);
    const r = await fake.inquireBalance();
    if (r.isOk()) expect(r.value.positions).toEqual([]);
  });

  it('forceError 모드에서는 모든 호출이 동일 에러로 실패', async () => {
    const fake = new FakeBrokerAdapter({
      forceError: { brokerId: 'KIS', kind: 'NETWORK', msg: 'down' },
    });
    const r = await fake.placeOrder({
      side: 'BUY',
      symbol: '005930',
      qty: 1,
      price: 70_000,
      kind: 'LIMIT',
    });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NETWORK');
  });

  it('isTradingDay — 기본 함수는 토/일 false, 그 외 true', async () => {
    const fake = new FakeBrokerAdapter();
    const monday = new Date('2024-12-30');
    const saturday = new Date('2024-12-28');
    const m = await fake.isTradingDay(monday);
    const s = await fake.isTradingDay(saturday);
    if (m.isOk()) expect(m.value).toBe(true);
    if (s.isOk()) expect(s.value).toBe(false);
  });

  it('listDailyExecutions — symbol/side filter', async () => {
    const fake = new FakeBrokerAdapter({
      dailyExecutions: [
        {
          brokerOrderId: '1',
          symbol: '005930',
          name: 'A',
          side: 'BUY',
          orderQty: 1,
          orderPrice: 1,
          orderedAt: '0',
          totalFilledQty: 1,
          remainingQty: 0,
          avgFillPrice: 1,
          cancelled: false,
          rejectedQty: 0,
        },
        {
          brokerOrderId: '2',
          symbol: '000660',
          name: 'B',
          side: 'SELL',
          orderQty: 1,
          orderPrice: 1,
          orderedAt: '0',
          totalFilledQty: 0,
          remainingQty: 1,
          avgFillPrice: 0,
          cancelled: false,
          rejectedQty: 0,
        },
      ],
    });
    const a = await fake.listDailyExecutions({
      from: new Date(),
      to: new Date(),
      symbol: '005930',
    });
    if (a.isOk()) expect(a.value).toHaveLength(1);
    const b = await fake.listDailyExecutions({ from: new Date(), to: new Date(), side: 'SELL' });
    if (b.isOk()) expect(b.value).toHaveLength(1);
    const filled = await fake.listDailyExecutions({
      from: new Date(),
      to: new Date(),
      filledOnly: true,
    });
    if (filled.isOk()) expect(filled.value).toHaveLength(1);
  });

  it('FakeRealtimePort — subscribe + emit', async () => {
    const fake = new FakeBrokerAdapter();
    const rt = fake.realtime();
    const events: RealtimeEvent[] = [];
    const sub = rt.subscribe('005930', 'TICK', (e) => events.push(e));
    expect(sub.isOk()).toBe(true);
    const tick: RealtimeEvent = {
      kind: 'TICK',
      data: { symbol: '005930', price: 71_000, volume: 100, tradedAt: '093015', seq: 1 },
    };
    if ('emit' in rt && typeof rt.emit === 'function') {
      rt.emit(tick);
    }
    expect(events).toHaveLength(1);
  });

  it('FakeRealtimePort — account dirty signal 구독/해제', async () => {
    const fake = new FakeBrokerAdapter();
    const rt = fake.realtime();
    const events: Array<{ kind: string }> = [];
    const sub = rt.subscribeAccountEvents((e) => events.push(e));
    expect(sub.isOk()).toBe(true);
    if ('emitAccount' in rt && typeof rt.emitAccount === 'function') {
      rt.emitAccount({ kind: 'BALANCE_DIRTY', symbol: '005930', at: '093000' });
    }
    expect(events).toEqual([{ kind: 'BALANCE_DIRTY', symbol: '005930', at: '093000' }]);
    if (sub.isOk()) sub.value.unsubscribe();
    if ('emitAccount' in rt && typeof rt.emitAccount === 'function') {
      rt.emitAccount({ kind: 'BALANCE_DIRTY', symbol: '005930', at: '093001' });
    }
    expect(events).toHaveLength(1);
  });

  it('ensureSession + invalidateSession — 상태 추적 가능', async () => {
    const fake = new FakeBrokerAdapter();
    const r = await fake.ensureSession();
    expect(r.isOk()).toBe(true);
    expect(fake.isSessionInvalidated()).toBe(false);
    fake.invalidateSession();
    expect(fake.isSessionInvalidated()).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { OrderbookUpdate, TickUpdate } from '../kis/ws-frame-parser';
import { FeedBus } from './feed-bus';

function mkTick(pdno: string, price: number): TickUpdate {
  return {
    pdno,
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
  };
}

function mkOrderbook(pdno: string): OrderbookUpdate {
  return {
    pdno,
    time: '093000',
    asks: [],
    bids: [],
    totalAskQty: 0,
    totalBidQty: 0,
    expectedPrice: 0,
    expectedQty: 0,
  };
}

describe('FeedBus', () => {
  it('emitTick 이후 subscribeTick이 즉시 스냅샷 수신', () => {
    const bus = new FeedBus();
    bus.emitTick(mkTick('005930', 70000));
    const received: TickUpdate[] = [];
    bus.subscribeTick('005930', (t) => received.push(t));
    expect(received).toHaveLength(1);
    expect(received[0]?.price).toBe(70000);
  });

  it('구독 후 새 emit 수신, unsubscribe 후 중단', () => {
    const bus = new FeedBus();
    const received: number[] = [];
    const unsub = bus.subscribeTick('005930', (t) => received.push(t.price));
    bus.emitTick(mkTick('005930', 100));
    bus.emitTick(mkTick('005930', 200));
    unsub();
    bus.emitTick(mkTick('005930', 300));
    expect(received).toEqual([100, 200]);
  });

  it('다른 종목은 격리', () => {
    const bus = new FeedBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribeTick('A', (t) => a.push(t.price));
    bus.subscribeTick('B', (t) => b.push(t.price));
    bus.emitTick(mkTick('A', 1));
    bus.emitTick(mkTick('B', 2));
    expect(a).toEqual([1]);
    expect(b).toEqual([2]);
  });

  it('getSubscriberCount 정확', () => {
    const bus = new FeedBus();
    const off1 = bus.subscribeTick('005930', () => {});
    const off2 = bus.subscribeTick('005930', () => {});
    bus.subscribeOrderbook('005930', () => {});
    expect(bus.getSubscriberCount('005930')).toEqual({ tick: 2, orderbook: 1 });
    off1();
    off2();
    expect(bus.getSubscriberCount('005930').tick).toBe(0);
  });

  it('orderbook emit/subscribe/스냅샷', () => {
    const bus = new FeedBus();
    bus.emitOrderbook(mkOrderbook('005930'));
    const received: OrderbookUpdate[] = [];
    bus.subscribeOrderbook('005930', (o) => received.push(o));
    expect(received).toHaveLength(1);
    expect(received[0]?.pdno).toBe('005930');
  });

  it('clear: 모든 구독자/스냅샷 제거', () => {
    const bus = new FeedBus();
    const received: number[] = [];
    bus.subscribeTick('X', (t) => received.push(t.price));
    bus.emitTick(mkTick('X', 1));
    expect(bus.getLatestTick('X')?.price).toBe(1);
    bus.clear();
    expect(bus.getLatestTick('X')).toBeNull();
    // clear 후 새 emit은 기존 리스너에 도달하지 않음
    bus.emitTick(mkTick('X', 2));
    expect(received).toEqual([1]);
  });
});

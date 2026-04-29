import { describe, expect, it, vi } from 'vitest';
import type { OrderbookUpdate, TickUpdate } from '../../kis/ws-frame-parser';
import { FeedBus } from '../../realtime/feed-bus';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { realtimeRouter } from './realtime-router';

const createCaller = t.createCallerFactory(realtimeRouter);

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
    time: '093001',
    asks: [{ price: 101, quantity: 10 }],
    bids: [{ price: 100, quantity: 20 }],
    totalAskQty: 10,
    totalBidQty: 20,
    expectedPrice: 0,
    expectedQty: 0,
  };
}

function createCtx(bus: FeedBus): Context {
  return {
    currentEnv: 'MOCK',
    bus,
  } as unknown as Context;
}

describe('realtimeRouter subscriptions', () => {
  it('start 성공 후 계좌 실시간 dirty subscription을 재연결한다', async () => {
    const start = vi.fn(async () => ({ ok: true as const }));
    const syncAccountRealtimeSubscription = vi.fn();
    const caller = createCaller({
      currentEnv: 'MOCK',
      realtime: { start },
      credentialsRepo: {
        loadCredentialsByEnv: () => ({
          isErr: () => false,
          value: {
            env: 'MOCK',
            broker: 'KIS',
            appKey: 'APPKEY_1234567890',
            appSecret: 'APPSECRET_1234567890',
            accountNo8: '12345678',
            accountProdCd: '01',
            htsId: 'HTS123',
          },
        }),
      },
      syncAccountRealtimeSubscription,
    } as unknown as Context);

    await expect(caller.start()).resolves.toEqual({ ok: true });
    expect(start).toHaveBeenCalledWith('APPKEY_1234567890', 'APPSECRET_1234567890');
    expect(syncAccountRealtimeSubscription).toHaveBeenCalledTimes(1);
  });

  it('onTick streams the latest snapshot and subsequent ticks', async () => {
    const bus = new FeedBus();
    bus.emitTick(mkTick('005930', 70_000));
    const caller = createCaller(createCtx(bus));
    const stream = await caller.onTick({ pdno: '005930' });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { price: 70_000 },
    });

    const nextTick = iterator.next();
    bus.emitTick(mkTick('005930', 70_100));
    await expect(nextTick).resolves.toMatchObject({
      done: false,
      value: { price: 70_100 },
    });

    await iterator.return?.();
    bus.emitTick(mkTick('005930', 70_200));
    expect(bus.getSubscriberCount('005930').tick).toBe(0);
  });

  it('onTicks streams a batched latest-tick map', async () => {
    const bus = new FeedBus();
    bus.emitTick(mkTick('005930', 70_000));
    const caller = createCaller(createCtx(bus));
    const stream = await caller.onTicks({ pdnos: ['005930', '000660'] });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value?.['005930']?.price).toBe(70_000);
    expect(first.value?.['000660']).toBeNull();

    const nextTicks = iterator.next();
    bus.emitTick(mkTick('000660', 120_000));
    const second = await nextTicks;
    expect(second.done).toBe(false);
    expect(second.value?.['005930']?.price).toBe(70_000);
    expect(second.value?.['000660']?.price).toBe(120_000);

    await iterator.return?.();
  });

  it('onOrderbook streams orderbook snapshots', async () => {
    const bus = new FeedBus();
    bus.emitOrderbook(mkOrderbook('005930'));
    const caller = createCaller(createCtx(bus));
    const stream = await caller.onOrderbook({ pdno: '005930' });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value?.bids[0]?.price).toBe(100);

    await iterator.return?.();
  });
});

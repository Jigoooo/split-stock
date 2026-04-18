import { describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { FakeTimer } from '../testing/fake-timer';
import { type QuoteUpdate, TieredQuoteFeed } from './tiered-quote-feed';

function noopLogger(): EventLogger {
  return { log: () => {} };
}

describe('TieredQuoteFeed', () => {
  it('WS 슬롯 여유 → 요청한 ws tier 그대로 배정', () => {
    const subscribed: string[] = [];
    const updates: QuoteUpdate[] = [];
    const feed = new TieredQuoteFeed({
      timer: new FakeTimer(),
      logger: noopLogger(),
      poller: { fetch: async () => ({ price: 0 }) },
      maxWsSlots: 3,
      restIntervalMs: 5_000,
      wsSubscribe: (p) => subscribed.push(p),
      onUpdate: (u) => updates.push(u),
    });
    feed.watch({ pdno: '005930', tier: 'ws' });
    feed.watch({ pdno: '000660', tier: 'ws' });
    expect(subscribed).toEqual(['005930', '000660']);
    expect(feed.wsSlotsUsed()).toBe(2);
  });

  it('WS 슬롯 초과 시 REST로 강등', () => {
    const subscribed: string[] = [];
    const feed = new TieredQuoteFeed({
      timer: new FakeTimer(),
      logger: noopLogger(),
      poller: { fetch: async () => ({ price: 0 }) },
      maxWsSlots: 2,
      wsSubscribe: (p) => subscribed.push(p),
    });
    feed.watch({ pdno: 'A', tier: 'ws' });
    feed.watch({ pdno: 'B', tier: 'ws' });
    feed.watch({ pdno: 'C', tier: 'ws' }); // 초과 → rest로
    const allocs = feed.getAllocations();
    expect(allocs.find((x) => x.pdno === 'C')?.tier).toBe('rest');
    expect(subscribed).toEqual(['A', 'B']);
  });

  it('WS에서 unwatch하면 rest에 있던 ws-preferred가 승격', () => {
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const feed = new TieredQuoteFeed({
      timer: new FakeTimer(),
      logger: noopLogger(),
      poller: { fetch: async () => ({ price: 0 }) },
      maxWsSlots: 2,
      wsSubscribe: (p) => subscribed.push(p),
      wsUnsubscribe: (p) => unsubscribed.push(p),
    });
    feed.watch({ pdno: 'A', tier: 'ws' });
    feed.watch({ pdno: 'B', tier: 'ws' });
    feed.watch({ pdno: 'C', tier: 'ws' }); // rest로 강등
    expect(feed.getAllocations().find((x) => x.pdno === 'C')?.tier).toBe('rest');

    feed.unwatch('A');
    expect(unsubscribed).toContain('A');
    expect(feed.getAllocations().find((x) => x.pdno === 'C')?.tier).toBe('ws');
    expect(subscribed).toEqual(['A', 'B', 'C']); // C 재구독됨
  });

  it('REST polling 주기마다 poller.fetch 호출 → onUpdate emit', async () => {
    const timer = new FakeTimer();
    const updates: QuoteUpdate[] = [];
    const prices: Record<string, number> = { X: 100, Y: 200 };
    const feed = new TieredQuoteFeed({
      timer,
      logger: noopLogger(),
      poller: {
        fetch: async (pdno) => ({ price: prices[pdno] ?? 0 }),
      },
      maxWsSlots: 0, // 모두 rest로
      restIntervalMs: 5_000,
      onUpdate: (u) => updates.push(u),
    });
    feed.watch({ pdno: 'X', tier: 'ws' }); // 슬롯 없으니 rest
    feed.watch({ pdno: 'Y', tier: 'rest' });

    timer.advance(5_000);
    // 비동기 poller.fetch가 완료될 기회 주기
    await new Promise((r) => setImmediate(r));

    expect(updates.map((u) => u.pdno).sort()).toEqual(['X', 'Y']);
    expect(updates.find((u) => u.pdno === 'X')?.price).toBe(100);
  });

  it('acceptWsUpdate: ws 배정 종목만 onUpdate', () => {
    const updates: QuoteUpdate[] = [];
    const feed = new TieredQuoteFeed({
      timer: new FakeTimer(),
      logger: noopLogger(),
      poller: { fetch: async () => ({ price: 0 }) },
      maxWsSlots: 1,
      onUpdate: (u) => updates.push(u),
    });
    feed.watch({ pdno: 'A', tier: 'ws' }); // ws
    feed.watch({ pdno: 'B', tier: 'ws' }); // rest로 강등

    feed.acceptWsUpdate({ pdno: 'A', price: 10, at: 0 });
    feed.acceptWsUpdate({ pdno: 'B', price: 20, at: 0 }); // rest 배정이므로 무시

    expect(updates.map((u) => u.pdno)).toEqual(['A']);
  });

  it('dispose: 모든 ws unsubscribe + 타이머 해제', () => {
    const unsubscribed: string[] = [];
    const timer = new FakeTimer();
    const feed = new TieredQuoteFeed({
      timer,
      logger: noopLogger(),
      poller: { fetch: async () => ({ price: 0 }) },
      maxWsSlots: 3,
      wsSubscribe: () => {},
      wsUnsubscribe: (p) => unsubscribed.push(p),
    });
    feed.watch({ pdno: 'X', tier: 'ws' });
    feed.watch({ pdno: 'Y', tier: 'ws' });
    feed.dispose();
    expect(unsubscribed.sort()).toEqual(['X', 'Y']);
    expect(feed.getAllocations()).toHaveLength(0);
  });
});

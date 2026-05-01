import { describe, expect, it, vi } from 'vitest';
import { UpbitExchangeAdapter } from './adapter';
import type { UpbitRateLimiter } from './rate-limiter';

function immediateLimiter(): UpbitRateLimiter {
  return {
    penalize: vi.fn(),
    schedule: vi.fn(async (_group, task) => task()),
  } as unknown as UpbitRateLimiter;
}

describe('UpbitExchangeAdapter.getCandles', () => {
  it('calls minute candle SDK and maps rows oldest first', async () => {
    const listMinutes = vi.fn(async () => [
      {
        market: 'KRW-BTC',
        candle_date_time_utc: '2026-05-01T00:01:00',
        opening_price: '101',
        high_price: '102',
        low_price: '100',
        trade_price: '101.5',
        candle_acc_trade_volume: '0.2',
        candle_acc_trade_price: '20.3',
        timestamp: Date.parse('2026-05-01T00:01:30.000Z'),
      },
      {
        market: 'KRW-BTC',
        candle_date_time_utc: '2026-05-01T00:00:00',
        opening_price: '100',
        high_price: '101',
        low_price: '99',
        trade_price: '100.5',
        candle_acc_trade_volume: '0.1',
        candle_acc_trade_price: '10.05',
        timestamp: Date.parse('2026-05-01T00:00:30.000Z'),
      },
    ]);
    const adapter = new UpbitExchangeAdapter({
      client: { candles: { listMinutes } } as never,
      limiter: immediateLimiter(),
    });

    const result = await adapter.getCandles({
      market: 'KRW-BTC',
      unit: '1m',
      count: 2,
      toMs: Date.parse('2026-05-01T00:02:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(listMinutes).toHaveBeenCalledWith(1, {
      market: 'KRW-BTC',
      count: 2,
      to: '2026-05-01T00:02:00.000Z',
    });
    expect(result.value.map((candle) => candle.close)).toEqual(['100.5', '101.5']);
    expect(result.value[0]?.candleAt).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
  });
});

describe('UpbitExchangeAdapter order reconciliation reads', () => {
  it('lists open and closed orders and maps order detail trades', async () => {
    async function* openOrders() {
      yield {
        uuid: 'open-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ord_type: 'limit',
        state: 'wait',
        created_at: '2026-05-01T00:00:00+09:00',
        price: '100',
        volume: '1',
        remaining_volume: '1',
        executed_volume: '0',
        paid_fee: '0',
        locked: '100',
      };
    }
    const listOpen = vi.fn(() => openOrders());
    const listClosed = vi.fn(async () => [
      {
        uuid: 'closed-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ord_type: 'limit',
        state: 'done',
        created_at: '2026-05-01T01:00:00+09:00',
        price: '100',
        volume: '1',
        remaining_volume: '0',
        executed_volume: '1',
        paid_fee: '0.05',
        locked: '0',
      },
    ]);
    const retrieve = vi.fn(async () => ({
      uuid: 'closed-uuid',
      market: 'KRW-BTC',
      side: 'bid',
      ord_type: 'limit',
      state: 'done',
      created_at: '2026-05-01T01:00:00+09:00',
      price: '100',
      volume: '1',
      remaining_volume: '0',
      executed_volume: '1',
      paid_fee: '0.05',
      locked: '0',
      trades: [
        {
          uuid: 'trade-uuid',
          market: 'KRW-BTC',
          side: 'bid',
          price: '100',
          volume: '1',
          funds: '100',
          created_at: '2026-05-01T01:00:01+09:00',
        },
      ],
    }));
    const adapter = new UpbitExchangeAdapter({
      client: { orders: { listOpen, listClosed, retrieve } } as never,
      limiter: immediateLimiter(),
    });

    const open = await adapter.listOpenOrders({ market: 'KRW-BTC', limit: 10 });
    const closed = await adapter.listClosedOrders({
      market: 'KRW-BTC',
      startTimeMs: Date.parse('2026-05-01T00:00:00.000Z'),
      endTimeMs: Date.parse('2026-05-01T02:00:00.000Z'),
      limit: 10,
    });
    const detail = await adapter.getOrder({ uuid: 'closed-uuid' });

    expect(open.isOk()).toBe(true);
    expect(closed.isOk()).toBe(true);
    expect(detail.isOk()).toBe(true);
    if (open.isErr() || closed.isErr() || detail.isErr()) return;
    expect(listOpen).toHaveBeenCalledWith({
      market: 'KRW-BTC',
      states: ['wait', 'watch'],
      order_by: 'desc',
    });
    expect(listClosed).toHaveBeenCalledWith({
      market: 'KRW-BTC',
      start_time: '2026-05-01T00:00:00.000Z',
      end_time: '2026-05-01T02:00:00.000Z',
      limit: 10,
      order_by: 'desc',
      states: ['done', 'cancel'],
    });
    expect(open.value[0]?.state).toBe('wait');
    expect(closed.value[0]?.state).toBe('done');
    expect(detail.value.trades?.[0]?.uuid).toBe('trade-uuid');
  });
});

import type Upbit from '@upbit-official/upbit-sdk';
import { describe, expect, it, vi } from 'vitest';
import { UpbitExchangeAdapter } from './adapter';
import type { UpbitRateLimiter, UpbitRateLimitGroup } from './rate-limiter';

const immediateLimiter = {
  schedule: <T>(_group: UpbitRateLimitGroup, task: () => Promise<T>) => task(),
} satisfies Pick<UpbitRateLimiter, 'schedule'>;

const chance = {
  bid_account: { balance: '10000.00000001', locked: '0', currency: 'KRW' },
  ask_account: { balance: '0.001', locked: '0', currency: 'BTC' },
  market: {
    id: 'KRW-BTC',
    bid: { min_total: '5000', currency: 'KRW' },
    ask: { min_total: '5000', currency: 'KRW' },
    bid_types: ['limit', 'price', 'best'],
    ask_types: ['limit', 'market', 'best'],
    state: 'active',
  },
};

function createAdapter(overrides: Partial<typeof chance> = {}) {
  const create = vi.fn().mockResolvedValue({
    uuid: 'order-uuid',
    side: 'bid',
    ord_type: 'limit',
    state: 'wait',
    market: 'KRW-BTC',
    created_at: '2026-05-01T00:00:00+09:00',
    remaining_volume: '0.001',
    executed_volume: '0',
    paid_fee: '0',
    locked: '5000',
  });
  const client = {
    orders: {
      retrieveChance: vi.fn().mockResolvedValue({ ...chance, ...overrides }),
      create,
    },
  } as unknown as Upbit;
  return {
    adapter: new UpbitExchangeAdapter({ client, limiter: immediateLimiter as UpbitRateLimiter }),
    create,
  };
}

describe('UpbitExchangeAdapter', () => {
  it('passes valid limit order parameters to the SDK after local validation', async () => {
    const { adapter, create } = createAdapter();

    const result = await adapter.createOrder({
      market: 'KRW-BTC',
      side: 'bid',
      ordType: 'limit',
      price: '5000.00000001',
      volume: '1',
    });

    expect(result.isOk()).toBe(true);
    expect(create).toHaveBeenCalledWith({
      market: 'KRW-BTC',
      side: 'bid',
      ord_type: 'limit',
      price: '5000.00000001',
      volume: '1',
    });
  });

  it('rejects orders below minimum total before hitting create endpoint', async () => {
    const { adapter, create } = createAdapter();

    const result = await adapter.createOrder({
      market: 'KRW-BTC',
      side: 'bid',
      ordType: 'limit',
      price: '4999.99999999',
      volume: '1',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe('BUSINESS');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects insufficient decimal balances without number rounding', async () => {
    const { adapter, create } = createAdapter({
      bid_account: { balance: '10000.00000000', locked: '0', currency: 'KRW' },
    });

    const result = await adapter.createOrder({
      market: 'KRW-BTC',
      side: 'bid',
      ordType: 'limit',
      price: '10000.00000001',
      volume: '1',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('매수 가능 잔고가 부족합니다.');
    expect(create).not.toHaveBeenCalled();
  });
});

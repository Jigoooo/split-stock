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

describe('UpbitExchangeAdapter transfer status reads', () => {
  it('maps deposit, withdrawal, and wallet status fixtures without execution calls', async () => {
    async function* deposits() {
      yield {
        uuid: 'deposit-uuid',
        currency: 'BTC',
        amount: '0.001',
        fee: '0',
        state: 'ACCEPTED',
        txid: 'deposit-txid',
        transaction_type: 'default',
        type: 'deposit',
        net_type: 'BTC',
        created_at: '2026-05-01T00:00:00+09:00',
        done_at: '2026-05-01T00:10:00+09:00',
      };
    }
    async function* withdrawals() {
      yield {
        uuid: 'withdraw-uuid',
        currency: 'ETH',
        amount: '1.25',
        fee: '0.01',
        state: 'DONE',
        txid: 'withdraw-txid',
        transaction_type: 'default',
        type: 'withdraw',
        net_type: 'ETH',
        created_at: '2026-05-01T01:00:00+09:00',
        done_at: '2026-05-01T01:20:00+09:00',
        is_cancelable: false,
      };
    }
    const createCoinAddress = vi.fn();
    const depositKrw = vi.fn();
    const cancelWithdrawal = vi.fn();
    const createKrwWithdrawal = vi.fn();
    const createWithdrawal = vi.fn();
    const retrieveDeposit = vi.fn(async () => (await deposits().next()).value);
    const retrieveWithdrawal = vi.fn(async () => (await withdrawals().next()).value);
    const adapter = new UpbitExchangeAdapter({
      client: {
        deposits: {
          list: vi.fn(() => deposits()),
          retrieve: retrieveDeposit,
          createCoinAddress,
          depositKrw,
        },
        withdraws: {
          list: vi.fn(() => withdrawals()),
          retrieve: retrieveWithdrawal,
          cancelWithdrawal,
          createKrwWithdrawal,
          createWithdrawal,
        },
        walletStatus: {
          list: vi.fn(async () => [
            {
              currency: 'BTC',
              net_type: 'BTC',
              network_name: 'Bitcoin',
              wallet_state: 'working',
              block_elapsed_minutes: 1,
              block_height: 900000,
              block_state: 'normal',
              block_updated_at: '2026-05-01T00:00:00+00:00',
            },
          ]),
        },
      } as never,
      limiter: immediateLimiter(),
    });

    const listedDeposits = await adapter.listDeposits({ currency: 'BTC', limit: 10 });
    const listedWithdrawals = await adapter.listWithdrawals({ currency: 'ETH', limit: 10 });
    const deposit = await adapter.getDeposit({ uuid: 'deposit-uuid' });
    const withdrawal = await adapter.getWithdrawal({ uuid: 'withdraw-uuid' });
    const wallets = await adapter.listWalletStatuses();

    expect(listedDeposits.isOk()).toBe(true);
    expect(listedWithdrawals.isOk()).toBe(true);
    expect(deposit.isOk()).toBe(true);
    expect(withdrawal.isOk()).toBe(true);
    expect(wallets.isOk()).toBe(true);
    if (
      listedDeposits.isErr() ||
      listedWithdrawals.isErr() ||
      deposit.isErr() ||
      withdrawal.isErr() ||
      wallets.isErr()
    ) {
      return;
    }
    expect(listedDeposits.value[0]).toMatchObject({
      direction: 'deposit',
      amount: '0.001',
      state: 'ACCEPTED',
    });
    expect(listedWithdrawals.value[0]).toMatchObject({
      direction: 'withdraw',
      amount: '1.25',
      fee: '0.01',
      isCancelable: false,
    });
    expect(wallets.value[0]).toMatchObject({
      currency: 'BTC',
      walletState: 'working',
      blockState: 'normal',
    });
    expect(createCoinAddress).not.toHaveBeenCalled();
    expect(depositKrw).not.toHaveBeenCalled();
    expect(cancelWithdrawal).not.toHaveBeenCalled();
    expect(createKrwWithdrawal).not.toHaveBeenCalled();
    expect(createWithdrawal).not.toHaveBeenCalled();
  });
});

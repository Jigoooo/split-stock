import type { CryptoCandle } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { CryptoTradingRepo } from './crypto-repo';

describe('CryptoTradingRepo candles', () => {
  it('upserts candles and lists them oldest first before a cursor', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const repo = new CryptoTradingRepo(db);
    const base: CryptoCandle = {
      exchange: 'UPBIT',
      market: 'KRW-BTC',
      unit: '1m',
      candleAt: Date.parse('2026-05-01T00:00:00.000Z'),
      open: '100',
      high: '110',
      low: '90',
      close: '105',
      volume: '0.1',
      tradePrice: '10.5',
    };

    repo.upsertCandles([
      base,
      { ...base, candleAt: base.candleAt + 60_000, close: '106' },
      { ...base, candleAt: base.candleAt + 120_000, close: '107' },
      { ...base, candleAt: base.candleAt + 60_000, close: '108' },
    ]);

    const rows = repo.listCandlesBefore({
      exchange: 'UPBIT',
      market: 'KRW-BTC',
      unit: '1m',
      count: 2,
      toMs: base.candleAt + 120_000,
    });

    expect(rows.map((row) => row.close)).toEqual(['108', '107']);
    expect(rows.map((row) => row.candleAt)).toEqual([
      base.candleAt + 60_000,
      base.candleAt + 120_000,
    ]);
  });
});

describe('CryptoTradingRepo order reconciliation state', () => {
  it('upserts order snapshots, fills, and realtime checkpoints idempotently', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const repo = new CryptoTradingRepo(db);

    const placedAt = Date.parse('2026-05-01T00:00:00.000Z');
    repo.upsertOrderSnapshot({
      accountId: 1,
      exchange: 'UPBIT',
      order: {
        uuid: 'order-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        state: 'done',
        price: '100',
        volume: '1',
        remainingVolume: '0',
        executedVolume: '1',
        paidFee: '0.05',
        locked: '0',
        placedAt,
        trades: [
          {
            uuid: 'trade-uuid',
            market: 'KRW-BTC',
            side: 'bid',
            price: '100',
            volume: '1',
            funds: '100',
            fee: '0.05',
            createdAt: placedAt + 1000,
          },
        ],
      },
    });
    repo.upsertOrderSnapshot({
      accountId: 1,
      exchange: 'UPBIT',
      order: {
        uuid: 'order-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        state: 'done',
        price: '100',
        volume: '1',
        remainingVolume: '0',
        executedVolume: '1',
        paidFee: '0.05',
        locked: '0',
        placedAt,
        trades: [
          {
            uuid: 'trade-uuid',
            market: 'KRW-BTC',
            side: 'bid',
            price: '101',
            volume: '1',
            funds: '101',
            fee: '0.05',
            createdAt: placedAt + 2000,
          },
        ],
      },
    });
    repo.upsertRealtimeCheckpoint({
      accountId: 1,
      exchange: 'UPBIT',
      stream: 'orders',
      lastEventAt: placedAt + 3000,
      cursor: { reason: 'test' },
    });

    expect(repo.listRecentOrders(1)).toHaveLength(1);
    expect(repo.listRecentOrders(1)[0]?.executedVolume).toBe('1');
    expect(repo.listFills(1)).toHaveLength(1);
    expect(repo.listFills(1)[0]?.price).toBe('101');
    expect(
      repo.getRealtimeCheckpoint({ accountId: 1, exchange: 'UPBIT', stream: 'orders' }),
    ).toMatchObject({
      accountId: 1,
      exchange: 'UPBIT',
      stream: 'orders',
      lastEventAt: placedAt + 3000,
      cursor: { reason: 'test' },
    });
  });
});

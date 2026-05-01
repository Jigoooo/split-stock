import type { CryptoOrderSnapshot } from '@shared/contracts';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { CryptoOrderReconciler } from './crypto-order-reconciler';
import { CryptoTradingRepo } from './crypto-repo';
import type { CryptoMarketDataAdapter } from './ports';

const now = Date.parse('2026-05-01T02:00:00.000Z');

function order(overrides: Partial<CryptoOrderSnapshot> = {}): CryptoOrderSnapshot {
  return {
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
    placedAt: now - 60_000,
    ...overrides,
  };
}

describe('CryptoOrderReconciler', () => {
  it('backfills open/closed orders, fetches detail for fills, and advances checkpoint', async () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const repo = new CryptoTradingRepo(db);
    const adapter = {
      listOpenOrders: vi.fn(async () =>
        ok([order({ uuid: 'open-uuid', state: 'wait', executedVolume: '0' })]),
      ),
      listClosedOrders: vi.fn(async () => ok([order({ uuid: 'closed-uuid' })])),
      getOrder: vi.fn(async () =>
        ok(
          order({
            uuid: 'closed-uuid',
            trades: [
              {
                uuid: 'trade-uuid',
                price: '100',
                volume: '1',
                funds: '100',
                createdAt: now - 30_000,
              },
            ],
          }),
        ),
      ),
    } as unknown as CryptoMarketDataAdapter;
    const logger = { log: vi.fn() };
    const reconciler = new CryptoOrderReconciler(repo, logger, () => now);

    const result = await reconciler.reconcile({
      accountId: 1,
      exchange: 'UPBIT',
      adapter,
      reason: 'startup',
      market: 'KRW-BTC',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toMatchObject({
      openOrders: 1,
      closedOrders: 1,
      detailedOrders: 1,
      persistedFills: 1,
      checkpointAt: now,
    });
    expect(adapter.listClosedOrders).toHaveBeenCalledWith({
      market: 'KRW-BTC',
      startTimeMs: now - 7 * 24 * 60 * 60 * 1000,
      endTimeMs: now,
      limit: 200,
    });
    expect(
      repo
        .listRecentOrders(1)
        .map((row) => row.uuid)
        .sort(),
    ).toEqual(['closed-uuid', 'open-uuid']);
    expect(repo.listFills(1)[0]?.tradeUuid).toBe('trade-uuid');
    expect(
      repo.getRealtimeCheckpoint({ accountId: 1, exchange: 'UPBIT', stream: 'orders' })
        ?.lastEventAt,
    ).toBe(now);
  });
});

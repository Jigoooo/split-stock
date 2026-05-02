import type { CryptoBalance } from '@shared/contracts';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { CryptoAutoTradingRepo } from './crypto-auto-repo';
import { type CryptoAutoLiveAdapter, CryptoAutoTradingService } from './crypto-auto-service';

const balances: CryptoBalance[] = [
  {
    currency: 'KRW',
    balance: '100000',
    locked: '0',
    avgBuyPrice: '0',
    unitCurrency: 'KRW',
  },
];

function setup(now = 100_000) {
  const db = createTestDb();
  bootstrapSchema(db);
  const repo = new CryptoAutoTradingRepo(db);
  const logger = { log: vi.fn() };
  const service = new CryptoAutoTradingService({ repo, logger, now: () => now });
  return { db, logger, repo, service };
}

function fakeAdapter(): CryptoAutoLiveAdapter & {
  createOrder: ReturnType<typeof vi.fn>;
  cancelOrder: ReturnType<typeof vi.fn>;
} {
  return {
    createOrder: vi.fn(async () =>
      ok({
        uuid: 'auto-order-uuid',
        market: 'KRW-BTC',
        side: 'bid',
        ord_type: 'price',
        state: 'wait',
        price: '5000',
        remaining_volume: '0',
        executed_volume: '0',
        paid_fee: '0',
        locked: '5000',
        created_at: '2026-05-02T00:00:00+09:00',
      }),
    ),
    cancelOrder: vi.fn(async () => ok({ uuid: 'auto-order-uuid' })),
  };
}

describe('CryptoAutoTradingService', () => {
  it('rejects non-KRW automation markets while generic manual crypto can remain broader', () => {
    const { service } = setup();
    const planned = service.plan({
      accountId: 1,
      market: 'BTC-ETH',
      balances,
      tradePrice: '100',
    });

    expect(planned.isErr()).toBe(true);
    expect(planned._unsafeUnwrapErr().kind).toBe('VALIDATION');
  });

  it('dry-run simulates split-buy lots without calling live exchange methods', () => {
    const { repo, service } = setup();
    const adapter = fakeAdapter();
    repo.upsertConfig(1, 'KRW-BTC', { mode: 'dry-run', emergencyDisabled: true });

    const result = service.runDryTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '100000000',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().intent).toMatchObject({ kind: 'plan-buy', krwAmount: '5000' });
    expect(repo.listOpenLots(1, 'KRW-BTC')).toHaveLength(1);
    expect(adapter.createOrder).not.toHaveBeenCalled();
    expect(adapter.cancelOrder).not.toHaveBeenCalled();
  });

  it('fails closed on invalid decimal input before creating intents', () => {
    const { service } = setup();
    const result = service.runDryTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: 'NaN',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('tradePrice');
  });

  it('blocks live-small until smoke, dry-run history, and emergency gates pass', async () => {
    const { repo, service } = setup();
    const adapter = fakeAdapter();
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'live-small',
      emergencyDisabled: true,
    });

    const blocked = await service.runLiveTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '100000000',
      adapter,
    });

    expect(blocked.isOk()).toBe(true);
    expect(blocked._unsafeUnwrap().gate.ok).toBe(false);
    expect(blocked._unsafeUnwrap().gate.blockedReasons).toEqual(
      expect.arrayContaining([
        '비상 중지 상태입니다.',
        '성공한 read-only smoke 기록이 없습니다.',
        'live 전 dry-run 이력이 없습니다.',
      ]),
    );
    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it('places a live-small market-buy only after every live gate passes', async () => {
    const { repo, service } = setup();
    const adapter = fakeAdapter();
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'dry-run',
      emergencyDisabled: true,
    });
    expect(
      service
        .runDryTick({
          accountId: 1,
          market: 'KRW-BTC',
          balances,
          tradePrice: '100000000',
        })
        .isOk(),
    ).toBe(true);
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'live-small',
      emergencyDisabled: false,
    });
    repo.markReadonlySmokeSucceeded(1, 'KRW-BTC', 99_000);

    const placed = await service.runLiveTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '97000000',
      adapter,
    });

    expect(placed.isOk()).toBe(true);
    expect(placed._unsafeUnwrap().gate.ok).toBe(true);
    expect(adapter.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'price',
        price: '5000',
        identifier: expect.stringContaining('crypto-auto:1:KRW-BTC:plan-buy:'),
      }),
    );
  });

  it('keeps dry-run lots out of live planning and exposure gates', async () => {
    const { repo, service } = setup();
    const adapter = fakeAdapter();
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'dry-run',
      emergencyDisabled: true,
      maxTotalExposureKrw: '5000',
    });
    expect(
      service
        .runDryTick({
          accountId: 1,
          market: 'KRW-BTC',
          balances,
          tradePrice: '100000000',
        })
        .isOk(),
    ).toBe(true);
    repo.markReadonlySmokeSucceeded(1, 'KRW-BTC', 99_000);
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'live-small',
      emergencyDisabled: false,
      maxTotalExposureKrw: '5000',
    });

    const plannedAtDryRunTakeProfit = service.plan({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '102000000',
    });
    const live = await service.runLiveTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '97000000',
      adapter,
    });

    expect(repo.listOpenLots(1, 'KRW-BTC')).toHaveLength(1);
    expect(plannedAtDryRunTakeProfit.isOk()).toBe(true);
    expect(plannedAtDryRunTakeProfit._unsafeUnwrap().kind).toBe('plan-buy');
    expect(live.isOk()).toBe(true);
    expect(live._unsafeUnwrap().gate.ok).toBe(true);
    expect(adapter.createOrder).toHaveBeenCalledOnce();
  });

  it('uses live lots, not simulated lots, when planning live-small sells', () => {
    const { repo, service } = setup();
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'live-small',
      emergencyDisabled: false,
    });
    const liveLot = repo.createLot({
      accountId: 1,
      market: 'KRW-BTC',
      source: 'live',
      quantity: '0.00005',
      avgEntryKrw: '100000000',
      allocatedKrw: '5000',
    });

    const planned = service.plan({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '102000000',
    });

    expect(planned.isOk()).toBe(true);
    expect(planned._unsafeUnwrap()).toMatchObject({
      kind: 'plan-sell',
      lotId: liveLot.id,
      quantity: '0.00005',
    });
  });

  it('does not call the exchange when live order placement itself fails validation', async () => {
    const { repo, service } = setup();
    const adapter = fakeAdapter();
    adapter.createOrder.mockResolvedValueOnce(
      err({ exchangeId: 'UPBIT', kind: 'VALIDATION', message: 'invalid' }),
    );
    repo.upsertConfig(1, 'KRW-BTC', {
      mode: 'live-small',
      emergencyDisabled: false,
    });
    repo.markReadonlySmokeSucceeded(1, 'KRW-BTC', 99_000);
    repo.insertEvent({
      accountId: 1,
      market: 'KRW-BTC',
      mode: 'dry-run',
      kind: 'dry-run',
      action: 'noop',
      reason: 'seed',
    });

    const result = await service.runLiveTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '100000000',
      adapter,
    });

    expect(result.isErr()).toBe(true);
    expect(adapter.createOrder).toHaveBeenCalledOnce();
  });
});

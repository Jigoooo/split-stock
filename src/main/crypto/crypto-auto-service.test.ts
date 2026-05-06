import { type CryptoBalance, createDefaultCryptoStrategyProfile } from '@shared/contracts';
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

/**
 * Phase 4-3: ensureLegacyConfigWatches 제거 후 — 자동매매 service 가 listWatches
 * 결과가 비어있으면 noop 을 반환하므로, 테스트 setup 시 명시적으로 WATCHING watch
 * 를 생성한다. autoBuyEnabled/autoSellEnabled=true 로 설정해 plan-buy/sell 트리거 가능.
 * 이전 legacy hack 의 strategyFromConfig (mode != 'disabled' → autoBuyEnabled=true) 와
 * 동등 의미.
 */
function seedWatching(repo: CryptoAutoTradingRepo, accountId: number, market: 'KRW-BTC'): void {
  const profile = createDefaultCryptoStrategyProfile(market);
  repo.upsertWatch(accountId, {
    market,
    status: 'WATCHING',
    entryCondition: { type: 'immediate', price: null },
    strategy: { ...profile, autoBuyEnabled: true, autoSellEnabled: true },
    guard: {},
  });
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
    seedWatching(repo, 1, 'KRW-BTC');
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

  it('uses stage-specific crypto strategy amount, trigger, and take-profit rules', () => {
    const { repo, service } = setup();
    seedWatching(repo, 1, 'KRW-BTC');
    repo.upsertConfig(1, 'KRW-BTC', { mode: 'dry-run', emergencyDisabled: true });
    repo.upsertStrategy(1, 'KRW-BTC', {
      ...createDefaultCryptoStrategyProfile('KRW-BTC'),
      maxStages: 2,
      buyRules: [
        { nth: 1, triggerDropPct: null, amountKrw: '7000' },
        { nth: 2, triggerDropPct: '0.05', amountKrw: '9000' },
      ],
      sellRules: [
        { nth: 1, targetProfitPct: '0.01' },
        { nth: 2, targetProfitPct: '0.03' },
      ],
      autoBuyEnabled: true,
      autoSellEnabled: true,
    });

    const first = service.runDryTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '100000000',
    });
    const second = service.runDryTick({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '95000000',
    });
    const sell = service.plan({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '101000000',
    });

    expect(first._unsafeUnwrap().intent).toMatchObject({ kind: 'plan-buy', krwAmount: '7000' });
    expect(second._unsafeUnwrap().intent).toMatchObject({ kind: 'plan-buy', krwAmount: '9000' });
    expect(sell._unsafeUnwrap()).toMatchObject({ kind: 'plan-sell' });
  });

  it('waits for an active watch entry condition before the first crypto buy', () => {
    const { repo, service } = setup();
    const profile = {
      ...createDefaultCryptoStrategyProfile('KRW-BTC'),
      autoBuyEnabled: true,
      autoSellEnabled: true,
    };
    repo.upsertWatch(1, {
      market: 'KRW-BTC',
      status: 'WATCHING',
      entryCondition: { type: 'price-below', price: '90000000' },
      strategy: profile,
      guard: { emergencyDisabled: true },
    });
    repo.upsertConfig(1, 'KRW-BTC', { mode: 'dry-run', emergencyDisabled: true });

    const waiting = service.plan({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '100000000',
    });
    const triggered = service.plan({
      accountId: 1,
      market: 'KRW-BTC',
      balances,
      tradePrice: '89000000',
    });

    expect(waiting._unsafeUnwrap()).toMatchObject({
      kind: 'noop',
      reason: '최초 매수 감시 조건이 충족되지 않았습니다.',
    });
    expect(triggered._unsafeUnwrap()).toMatchObject({ kind: 'plan-buy' });
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
    seedWatching(repo, 1, 'KRW-BTC');
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
    seedWatching(repo, 1, 'KRW-BTC');
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
    seedWatching(repo, 1, 'KRW-BTC');
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

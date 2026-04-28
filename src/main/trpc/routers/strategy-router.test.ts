import { createStrategyRules, type StrategyProfile } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb } from '../../db/client';
import { SettingsRepo } from '../../db/settings-repo';
import { StrategyRepo } from '../../trading/strategy-repo';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { strategyRouter } from './strategy-router';

const createCaller = t.createCallerFactory(strategyRouter);

function baseProfile(overrides: Partial<StrategyProfile> = {}): StrategyProfile {
  return {
    version: 2,
    maxStages: 3,
    ...createStrategyRules(3, {
      amountKrw: 700_000,
      dropPct: 0.03,
      profitPct: 0.05,
    }),
    autoBuyEnabled: false,
    autoBuyOrderType: 'LIMIT',
    autoSellEnabled: false,
    autoSellOrderType: 'LIMIT',
    ...overrides,
  };
}

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const logger = { log: vi.fn() };
  const strategyRepo = new StrategyRepo(new SettingsRepo(db), logger as never);
  const strategyEngine = {
    refreshTrackedSymbols: vi.fn(),
    evaluateLatest: vi.fn(),
    evaluateLatestForTracked: vi.fn(),
  };
  const ctx = {
    db,
    activeAccountId: 1,
    strategyRepo,
    strategyEngine,
  } as unknown as Context;

  return { caller: createCaller(ctx), strategyEngine, strategyRepo };
}

describe('strategy-router', () => {
  it('setAutoModeQuick 저장 후 해당 종목을 최신 tick으로 즉시 평가 요청한다', async () => {
    const { caller, strategyEngine, strategyRepo } = setup();

    await caller.setAutoModeQuick({ accountId: 1, pdno: '005930', mode: 'SELL_ONLY' });

    expect(strategyEngine.refreshTrackedSymbols).toHaveBeenCalledTimes(1);
    expect(strategyEngine.evaluateLatest).toHaveBeenCalledWith('005930');
    expect(strategyEngine.evaluateLatestForTracked).not.toHaveBeenCalled();
    const saved = strategyRepo.getActive(1, '005930');
    expect(saved.isOk() ? saved.value?.autoSellEnabled : false).toBe(true);
  });

  it('글로벌 전략 저장 후 기존 종목별 자동 제어를 갱신하고 전체 종목을 즉시 평가 요청한다', async () => {
    const { caller, strategyEngine, strategyRepo } = setup();
    strategyRepo.setActive(
      1,
      '005930',
      baseProfile({ autoBuyEnabled: false, autoSellEnabled: false }),
    );

    await caller.setActive({
      accountId: 1,
      pdno: null,
      profile: baseProfile({
        autoBuyEnabled: true,
        autoBuyOrderType: 'MARKET',
        autoSellEnabled: true,
        autoSellOrderType: 'MARKET',
      }),
    });

    const symbolProfile = strategyRepo.getActive(1, '005930')._unsafeUnwrap();
    expect(symbolProfile).toMatchObject({
      autoBuyEnabled: true,
      autoBuyOrderType: 'MARKET',
      autoSellEnabled: true,
      autoSellOrderType: 'MARKET',
    });
    expect(strategyEngine.refreshTrackedSymbols).toHaveBeenCalledTimes(1);
    expect(strategyEngine.evaluateLatest).not.toHaveBeenCalled();
    expect(strategyEngine.evaluateLatestForTracked).toHaveBeenCalledTimes(1);
  });

  it('비활성 계좌 전략 저장은 현재 활성 계좌 엔진 평가를 건드리지 않는다', async () => {
    const { caller, strategyEngine } = setup();

    await caller.setAutoModeQuick({ accountId: 2, pdno: '005930', mode: 'SELL_ONLY' });

    expect(strategyEngine.refreshTrackedSymbols).not.toHaveBeenCalled();
    expect(strategyEngine.evaluateLatest).not.toHaveBeenCalled();
    expect(strategyEngine.evaluateLatestForTracked).not.toHaveBeenCalled();
  });
});

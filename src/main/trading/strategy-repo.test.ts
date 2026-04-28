import {
  applyStrategyAutoMode,
  createStrategyRules,
  DEFAULT_STRATEGY_PROFILE,
  MAX_STRATEGY_STAGES,
  type StrategyProfile,
} from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import { StrategyRepo } from './strategy-repo';

const ACC_A = 1;
const ACC_B = 2;

function buildLogger(): EventLogger & { entries: Array<{ message: string; payload?: unknown }> } {
  const entries: Array<{ message: string; payload?: unknown }> = [];
  return {
    entries,
    log: (event) => entries.push({ message: event.message, payload: event.payload }),
  };
}

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const settings = new SettingsRepo(db);
  const logger = buildLogger();
  return { settings, logger, repo: new StrategyRepo(settings, logger) };
}

function baseProfile(overrides: Partial<StrategyProfile> = {}): StrategyProfile {
  const maxStages = overrides.maxStages ?? 5;
  return {
    version: 2,
    maxStages,
    ...createStrategyRules(maxStages, {
      amountKrw: 1_000_000,
      dropPct: 0.03,
      profitPct: 0.05,
    }),
    autoBuyEnabled: true,
    autoBuyOrderType: 'LIMIT',
    autoSellEnabled: true,
    autoSellOrderType: 'LIMIT',
    ...overrides,
  };
}

describe('StrategyRepo — active/preset', () => {
  it('계좌 글로벌 active 라운드트립 + strategy.updated 로그 기록', () => {
    const { repo, logger } = setup();
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()).toBeNull();

    const result = repo.setActive(ACC_A, null, baseProfile());
    expect(result.isOk()).toBe(true);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.buyRules[0]?.amountKrw).toBe(1_000_000);

    const log = logger.entries.find((entry) => entry.message === 'strategy.updated');
    expect(log).toBeTruthy();
  });

  it('종목별 active와 글로벌은 독립 키', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile());
    repo.setActive(
      ACC_A,
      '005930',
      baseProfile({ buyRules: createStrategyRules(5, { amountKrw: 500_000 }).buyRules }),
    );

    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.buyRules[0]?.amountKrw).toBe(1_000_000);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.buyRules[0]?.amountKrw).toBe(500_000);
  });

  it('ensureSeededActive: 글로벌 active가 있으면 복사하고, 없으면 기본 프로필을 사용한다', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ autoBuyEnabled: false }));
    const seededFromGlobal = repo.ensureSeededActive(ACC_A, '005930');
    expect(seededFromGlobal.isOk()).toBe(true);
    if (seededFromGlobal.isErr()) throw new Error('seed failed');
    expect(seededFromGlobal.value.source).toBe('global');
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.autoBuyEnabled).toBe(false);

    const seededDefault = repo.ensureSeededActive(ACC_B, '000660');
    expect(seededDefault.isOk()).toBe(true);
    if (seededDefault.isErr()) throw new Error('seed failed');
    expect(seededDefault.value.source).toBe('default');
    expect(repo.getActive(ACC_B, '000660')._unsafeUnwrap()?.maxStages).toBe(
      DEFAULT_STRATEGY_PROFILE.maxStages,
    );
    expect(repo.getActive(ACC_B, '000660')._unsafeUnwrap()).toMatchObject({
      autoBuyEnabled: false,
      autoSellEnabled: false,
    });
  });

  it('savePreset/listPresets/deletePreset는 계좌별로 분리된다', () => {
    const { repo } = setup();
    repo.savePreset(ACC_A, 'A전용', baseProfile());
    repo.savePreset(ACC_B, 'B전용', baseProfile({ autoSellEnabled: false }));
    expect(repo.listPresets(ACC_A).map((preset) => preset.name)).toEqual(['A전용']);
    expect(repo.listPresets(ACC_B).map((preset) => preset.name)).toEqual(['B전용']);
    repo.deletePreset(ACC_A, 'A전용');
    expect(repo.listPresets(ACC_A)).toEqual([]);
  });

  it('maxStages 밖 비활성 차수 값은 저장소 재생성 후에도 보존된다', () => {
    const { settings, logger, repo } = setup();
    const fullRules = createStrategyRules(MAX_STRATEGY_STAGES, {
      amountKrw: 1_000_000,
      dropPct: 0.03,
      profitPct: 0.05,
    });
    const profile = baseProfile({
      maxStages: 5,
      buyRules: fullRules.buyRules.map((rule) =>
        rule.nth === 12 ? { ...rule, amountKrw: 777_000, triggerDropPct: 0.12 } : rule,
      ),
      sellRules: fullRules.sellRules.map((rule) =>
        rule.nth === 12 ? { ...rule, targetProfitPct: 0.18 } : rule,
      ),
    });

    expect(repo.setActive(ACC_A, '005930', profile).isOk()).toBe(true);

    const restarted = new StrategyRepo(settings, logger);
    const loaded = restarted.getActive(ACC_A, '005930')._unsafeUnwrap();
    expect(loaded?.buyRules).toHaveLength(MAX_STRATEGY_STAGES);
    expect(loaded?.buyRules[11]?.amountKrw).toBe(777_000);
    expect(loaded?.buyRules[11]?.triggerDropPct).toBe(0.12);
    expect(loaded?.sellRules[11]?.targetProfitPct).toBe(0.18);

    const quickChanged = applyStrategyAutoMode(loaded as StrategyProfile, 'BUY_ONLY');
    expect(restarted.setActive(ACC_A, '005930', quickChanged).isOk()).toBe(true);

    const restartedAgain = new StrategyRepo(settings, logger);
    const afterQuickMutation = restartedAgain.getActive(ACC_A, '005930')._unsafeUnwrap();
    expect(afterQuickMutation?.buyRules[11]?.amountKrw).toBe(777_000);
    expect(afterQuickMutation?.buyRules).toHaveLength(MAX_STRATEGY_STAGES);
  });

  it('getEffectiveForEdit는 종목 override 없이 글로벌/기본값을 읽기 전용 fallback으로 반환한다', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ autoBuyEnabled: false }));

    const fromGlobal = repo.getEffectiveForEdit(ACC_A, '005930')._unsafeUnwrap();
    expect(fromGlobal.source).toBe('global');
    expect(fromGlobal.hasOverride).toBe(false);
    expect(fromGlobal.profile.autoBuyEnabled).toBe(false);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()).toBeNull();

    const fromDefault = repo.getEffectiveForEdit(ACC_B, '000660')._unsafeUnwrap();
    expect(fromDefault.source).toBe('default');
    expect(fromDefault.hasOverride).toBe(false);
    expect(fromDefault.profile.maxStages).toBe(DEFAULT_STRATEGY_PROFILE.maxStages);
  });
});

describe('StrategyRepo — legacy compatibility', () => {
  it('readProfile/setActive/savePreset는 legacy shape도 허용한다', () => {
    const { repo } = setup();
    const legacyLike = {
      totalAmountKrw: 5_000_000,
      maxStages: 5,
      dropPct: 0.03,
      profitPct: 0.05,
      autoBuyEnabled: true,
      autoBuyOrderType: 'LIMIT' as const,
      autoSellEnabled: true,
      autoSellOrderType: 'LIMIT' as const,
    };

    expect(repo.setActive(ACC_A, null, legacyLike as unknown as StrategyProfile).isOk()).toBe(true);
    expect(repo.savePreset(ACC_A, 'legacy', legacyLike as unknown as StrategyProfile).isOk()).toBe(
      true,
    );
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.buyRules[1]?.triggerDropPct).toBe(0.03);
    expect(repo.listPresets(ACC_A)[0]?.profile.sellRules[0]?.targetProfitPct).toBe(0.05);
  });

  it('upgradeStoredProfiles: legacy JSON을 신형으로 업그레이드하고 깨진 항목은 기본값으로 복구한다', () => {
    const { settings, repo } = setup();
    settings.set(
      `strategy.active.${ACC_A}`,
      JSON.stringify({
        totalAmountKrw: 5_000_000,
        maxStages: 5,
        dropPct: 0.03,
        profitPct: 0.05,
        autoBuyEnabled: true,
        autoBuyOrderType: 'LIMIT',
        autoSellEnabled: true,
        autoSellOrderType: 'LIMIT',
      }),
    );
    settings.set(`strategy.active.${ACC_A}.005930`, '{bad-json');

    const result = repo.upgradeStoredProfiles();
    expect(result.upgraded).toBe(1);
    expect(result.recovered).toBe(1);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.buyRules[1]?.triggerDropPct).toBe(0.03);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()).toEqual(DEFAULT_STRATEGY_PROFILE);
  });

  it('upgradeStoredProfiles: 예전 기본 자동 ON active 설정은 OFF로 낮춘다', () => {
    const { settings, repo } = setup();
    settings.set(
      `strategy.active.${ACC_A}.005930`,
      JSON.stringify({
        ...DEFAULT_STRATEGY_PROFILE,
        autoBuyEnabled: true,
        autoSellEnabled: true,
      }),
    );

    const result = repo.upgradeStoredProfiles();

    expect(result.autoDisabled).toBe(1);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()).toMatchObject({
      autoBuyEnabled: false,
      autoSellEnabled: false,
    });
  });

  it('migrateLegacyKeys는 기존 단일 계좌 키를 신규 형식으로 옮긴다', () => {
    const { settings, repo } = setup();
    settings.set('strategy.active', JSON.stringify(baseProfile()));
    settings.set('strategy.active.005930', JSON.stringify(baseProfile({ autoSellEnabled: false })));
    settings.set('strategy.preset.대형주', JSON.stringify(baseProfile()));

    const result = repo.migrateLegacyKeys(ACC_A);
    expect(result.migrated).toBe(3);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.maxStages).toBe(5);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.autoSellEnabled).toBe(false);
    expect(repo.listPresets(ACC_A).map((preset) => preset.name)).toEqual(['대형주']);
  });
});

describe('StrategyRepo — backfill', () => {
  it('보유 종목 목록을 받아 종목별 설정이 없는 항목만 시드한다', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ autoBuyEnabled: false }));
    repo.setActive(ACC_A, '005930', baseProfile({ autoBuyEnabled: true }));

    const result = repo.backfillMissingActiveProfiles(ACC_A, ['005930', '000660']);
    expect(result.seeded).toBe(1);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.autoBuyEnabled).toBe(true);
    expect(repo.getActive(ACC_A, '000660')._unsafeUnwrap()?.autoBuyEnabled).toBe(false);
  });

  it('기본 자동매매 ON/OFF 저장은 기존 종목별 전략의 자동 제어만 갱신한다', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ autoBuyEnabled: false, autoSellEnabled: false }));
    repo.setActive(
      ACC_A,
      '005930',
      baseProfile({
        autoBuyEnabled: false,
        autoSellEnabled: false,
        buyRules: createStrategyRules(5, { amountKrw: 500_000 }).buyRules,
      }),
    );
    repo.setActive(ACC_B, '000660', baseProfile({ autoBuyEnabled: false }));

    const result = repo.applyAutoControlsToSymbolActives(ACC_A, {
      autoBuyEnabled: true,
      autoBuyOrderType: 'MARKET',
      autoSellEnabled: true,
      autoSellOrderType: 'MARKET',
    });

    const updated = repo.getActive(ACC_A, '005930')._unsafeUnwrap();
    expect(result).toEqual({ updated: 1, failed: 0 });
    expect(updated).toMatchObject({
      autoBuyEnabled: true,
      autoBuyOrderType: 'MARKET',
      autoSellEnabled: true,
      autoSellOrderType: 'MARKET',
    });
    expect(updated?.buyRules[0]?.amountKrw).toBe(500_000);
    expect(repo.getActive(ACC_B, '000660')._unsafeUnwrap()?.autoBuyEnabled).toBe(false);
  });
});

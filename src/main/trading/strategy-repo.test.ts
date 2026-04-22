import type { StrategyProfile } from '@shared/contracts';
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
    log: (e) => entries.push({ message: e.message, payload: e.payload }),
  };
}

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  const settings = new SettingsRepo(db);
  const logger = buildLogger();
  return { settings, logger, repo: new StrategyRepo(settings, logger) };
}

const baseProfile = (overrides: Partial<StrategyProfile> = {}): StrategyProfile => ({
  totalAmountKrw: 5_000_000,
  maxStages: 5,
  dropPct: 0.03,
  profitPct: 0.05,
  autoBuyEnabled: true,
  autoBuyOrderType: 'LIMIT',
  autoSellEnabled: true,
  autoSellOrderType: 'LIMIT',
  ...overrides,
});

describe('StrategyRepo — active', () => {
  it('계좌 글로벌 active 라운드트립 + strategy.updated 로그 기록', () => {
    const { repo, logger } = setup();
    expect(repo.getActive(ACC_A, null).isOk()).toBe(true);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()).toBeNull();

    const r = repo.setActive(ACC_A, null, baseProfile());
    expect(r.isOk()).toBe(true);

    const loaded = repo.getActive(ACC_A, null);
    expect(loaded.isOk()).toBe(true);
    expect(loaded._unsafeUnwrap()?.maxStages).toBe(5);

    const log = logger.entries.find((e) => e.message === 'strategy.updated');
    expect(log).toBeTruthy();
    const payload = log?.payload as
      | { before: unknown; after: unknown; pdno: string; accountId: number }
      | undefined;
    expect(payload?.before).toBeNull();
    expect(payload?.accountId).toBe(ACC_A);
  });

  it('종목별 active와 글로벌은 독립 키', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.02 }));
    repo.setActive(ACC_A, '005930', baseProfile({ dropPct: 0.05 }));

    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.dropPct).toBe(0.02);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.dropPct).toBe(0.05);
  });

  it('두 번째 setActive 호출은 before/after diff 기록', () => {
    const { repo, logger } = setup();
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.02 }));
    logger.entries.length = 0; // reset
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.05 }));

    const log = logger.entries.find((e) => e.message === 'strategy.updated');
    const p = log?.payload as
      | { before: StrategyProfile | null; after: StrategyProfile }
      | undefined;
    expect(p?.before?.dropPct).toBe(0.02);
    expect(p?.after.dropPct).toBe(0.05);
  });

  it('Zod 범위 벗어난 dropPct → VALIDATION 에러', () => {
    const { repo } = setup();
    const r = repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.9 }));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });

  it('clearActive 호출 전후 getActive 결과', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile());
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()).not.toBeNull();
    repo.clearActive(ACC_A, null);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()).toBeNull();
  });

  it('ensureSeededActive: 종목별 전략이 없으면 글로벌 active를 복사한다', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.07 }));

    const seeded = repo.ensureSeededActive(ACC_A, '005930');
    expect(seeded.isOk()).toBe(true);
    if (seeded.isErr()) throw new Error('seed failed');
    expect(seeded.value.seeded).toBe(true);
    expect(seeded.value.source).toBe('global');
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.dropPct).toBe(0.07);
  });

  it('ensureSeededActive: 글로벌 전략도 없으면 기본 프로필을 시드한다', () => {
    const { repo } = setup();

    const seeded = repo.ensureSeededActive(ACC_A, '005930');
    expect(seeded.isOk()).toBe(true);
    if (seeded.isErr()) throw new Error('seed failed');
    expect(seeded.value.source).toBe('default');
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.maxStages).toBe(5);
  });
});

describe('StrategyRepo — preset', () => {
  it('savePreset + listPresets 정렬 (계좌별 격리)', () => {
    const { repo } = setup();
    repo.savePreset(ACC_A, '대형주', baseProfile({ dropPct: 0.02, profitPct: 0.04 }));
    repo.savePreset(ACC_A, '코스닥변동', baseProfile({ dropPct: 0.05, profitPct: 0.08 }));

    const presets = repo.listPresets(ACC_A);
    expect(presets.map((p) => p.name)).toEqual(['대형주', '코스닥변동']);
    expect(presets[0]?.profile.dropPct).toBe(0.02);
  });

  it('deletePreset', () => {
    const { repo } = setup();
    repo.savePreset(ACC_A, '대형주', baseProfile());
    repo.savePreset(ACC_A, '코스닥변동', baseProfile());
    repo.deletePreset(ACC_A, '대형주');
    expect(repo.listPresets(ACC_A).map((p) => p.name)).toEqual(['코스닥변동']);
  });

  it('프리셋 이름 빈문자열 → VALIDATION', () => {
    const { repo } = setup();
    const r = repo.savePreset(ACC_A, '', baseProfile());
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });
});

describe('StrategyRepo — 파싱 에러', () => {
  it('손상된 JSON → PARSE_FAILED', () => {
    const { settings, logger } = setup();
    settings.set(`strategy.active.${ACC_A}`, '{not-json');
    const repo = new StrategyRepo(settings, logger);
    const r = repo.getActive(ACC_A, null);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('PARSE_FAILED');
  });
});

describe('StrategyRepo — per-account 격리', () => {
  it('계좌 A의 active 가 계좌 B에 보이지 않음', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.02 }));
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.dropPct).toBe(0.02);
    expect(repo.getActive(ACC_B, null)._unsafeUnwrap()).toBeNull();
  });

  it('동일 종목 active 라도 계좌 다르면 분리', () => {
    const { repo } = setup();
    repo.setActive(ACC_A, '005930', baseProfile({ dropPct: 0.02 }));
    repo.setActive(ACC_B, '005930', baseProfile({ dropPct: 0.07 }));
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.dropPct).toBe(0.02);
    expect(repo.getActive(ACC_B, '005930')._unsafeUnwrap()?.dropPct).toBe(0.07);
  });

  it('listPresets 는 해당 계좌 prefix 만 필터', () => {
    const { repo } = setup();
    repo.savePreset(ACC_A, 'A전용', baseProfile({ dropPct: 0.02 }));
    repo.savePreset(ACC_B, 'B전용', baseProfile({ dropPct: 0.07 }));
    expect(repo.listPresets(ACC_A).map((p) => p.name)).toEqual(['A전용']);
    expect(repo.listPresets(ACC_B).map((p) => p.name)).toEqual(['B전용']);
  });
});

describe('StrategyRepo — migrateLegacyKeys', () => {
  it('단일 계좌 시절 active 글로벌 키를 신규 형식으로 이전', () => {
    const { settings, repo } = setup();
    settings.set('strategy.active', JSON.stringify(baseProfile({ dropPct: 0.02 })));
    const r = repo.migrateLegacyKeys(ACC_A);
    expect(r.migrated).toBe(1);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.dropPct).toBe(0.02);
    expect(settings.get('strategy.active')).toBeNull();
  });

  it('단일 계좌 시절 종목별 active 키 (strategy.active.{pdno}) 이전', () => {
    const { settings, repo } = setup();
    settings.set('strategy.active.005930', JSON.stringify(baseProfile({ dropPct: 0.04 })));
    const r = repo.migrateLegacyKeys(ACC_A);
    expect(r.migrated).toBe(1);
    expect(repo.getActive(ACC_A, '005930')._unsafeUnwrap()?.dropPct).toBe(0.04);
  });

  it('단일 계좌 시절 preset 키 (strategy.preset.{name}) 이전', () => {
    const { settings, repo } = setup();
    settings.set('strategy.preset.대형주', JSON.stringify(baseProfile({ dropPct: 0.02 })));
    const r = repo.migrateLegacyKeys(ACC_A);
    expect(r.migrated).toBe(1);
    expect(repo.listPresets(ACC_A).map((p) => p.name)).toEqual(['대형주']);
  });

  it('이미 신규 형식인 키는 다시 이전하지 않음 (멱등)', () => {
    const { settings, repo } = setup();
    repo.setActive(ACC_A, null, baseProfile({ dropPct: 0.02 }));
    repo.savePreset(ACC_A, '대형주', baseProfile());
    const r = repo.migrateLegacyKeys(ACC_A);
    expect(r.migrated).toBe(0);
    expect(repo.getActive(ACC_A, null)._unsafeUnwrap()?.dropPct).toBe(0.02);
    void settings; // typescript usage
  });
});

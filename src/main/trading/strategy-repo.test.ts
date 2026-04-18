import type { StrategyProfile } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import { StrategyRepo } from './strategy-repo';

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
  ...overrides,
});

describe('StrategyRepo — active', () => {
  it('글로벌 active 라운드트립 + strategy.updated 로그 기록', () => {
    const { repo, logger } = setup();
    expect(repo.getActive(null).isOk()).toBe(true);
    expect(repo.getActive(null)._unsafeUnwrap()).toBeNull();

    const r = repo.setActive(null, baseProfile());
    expect(r.isOk()).toBe(true);

    const loaded = repo.getActive(null);
    expect(loaded.isOk()).toBe(true);
    expect(loaded._unsafeUnwrap()?.maxStages).toBe(5);

    const log = logger.entries.find((e) => e.message === 'strategy.updated');
    expect(log).toBeTruthy();
    expect(
      (log?.payload as { before: unknown; after: unknown; pdno: string } | undefined)?.before,
    ).toBeNull();
  });

  it('종목별 active와 글로벌은 독립 키', () => {
    const { repo } = setup();
    repo.setActive(null, baseProfile({ dropPct: 0.02 }));
    repo.setActive('005930', baseProfile({ dropPct: 0.05 }));

    expect(repo.getActive(null)._unsafeUnwrap()?.dropPct).toBe(0.02);
    expect(repo.getActive('005930')._unsafeUnwrap()?.dropPct).toBe(0.05);
  });

  it('두 번째 setActive 호출은 before/after diff 기록', () => {
    const { repo, logger } = setup();
    repo.setActive(null, baseProfile({ dropPct: 0.02 }));
    logger.entries.length = 0; // reset
    repo.setActive(null, baseProfile({ dropPct: 0.05 }));

    const log = logger.entries.find((e) => e.message === 'strategy.updated');
    const p = log?.payload as
      | { before: StrategyProfile | null; after: StrategyProfile }
      | undefined;
    expect(p?.before?.dropPct).toBe(0.02);
    expect(p?.after.dropPct).toBe(0.05);
  });

  it('Zod 범위 벗어난 dropPct → VALIDATION 에러', () => {
    const { repo } = setup();
    const r = repo.setActive(null, baseProfile({ dropPct: 0.9 }));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });

  it('clearActive 호출 전후 getActive 결과', () => {
    const { repo } = setup();
    repo.setActive(null, baseProfile());
    expect(repo.getActive(null)._unsafeUnwrap()).not.toBeNull();
    repo.clearActive(null);
    expect(repo.getActive(null)._unsafeUnwrap()).toBeNull();
  });
});

describe('StrategyRepo — preset', () => {
  it('savePreset + listPresets 정렬', () => {
    const { repo } = setup();
    repo.savePreset('대형주', baseProfile({ dropPct: 0.02, profitPct: 0.04 }));
    repo.savePreset('코스닥변동', baseProfile({ dropPct: 0.05, profitPct: 0.08 }));

    const presets = repo.listPresets();
    expect(presets.map((p) => p.name)).toEqual(['대형주', '코스닥변동']);
    expect(presets[0]?.profile.dropPct).toBe(0.02);
  });

  it('deletePreset', () => {
    const { repo } = setup();
    repo.savePreset('대형주', baseProfile());
    repo.savePreset('코스닥변동', baseProfile());
    repo.deletePreset('대형주');
    expect(repo.listPresets().map((p) => p.name)).toEqual(['코스닥변동']);
  });

  it('프리셋 이름 빈문자열 → VALIDATION', () => {
    const { repo } = setup();
    const r = repo.savePreset('', baseProfile());
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('VALIDATION');
  });
});

describe('StrategyRepo — 파싱 에러', () => {
  it('손상된 JSON → PARSE_FAILED', () => {
    const { settings, logger } = setup();
    settings.set('strategy.active', '{not-json');
    const repo = new StrategyRepo(settings, logger);
    const r = repo.getActive(null);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('PARSE_FAILED');
  });
});

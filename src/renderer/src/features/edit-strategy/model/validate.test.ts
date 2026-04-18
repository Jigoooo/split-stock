import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, validateProfile } from './validate';

describe('validateProfile', () => {
  it('기본값은 통과', () => {
    const r = validateProfile(DEFAULT_PROFILE as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
  });

  it('dropPct 범위 초과 → 필드 에러', () => {
    const r = validateProfile({
      totalAmountKrw: 1_000_000,
      maxStages: 5,
      dropPct: 0.9, // >0.5
      profitPct: 0.05,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.dropPct).toBeTruthy();
  });

  it('여러 필드 오류 동시 보고', () => {
    const r = validateProfile({
      totalAmountKrw: -100,
      maxStages: 0,
      dropPct: 0.03,
      profitPct: 0.05,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.totalAmountKrw).toBeTruthy();
      expect(r.errors.maxStages).toBeTruthy();
    }
  });

  it('booster 선택 필드 — 생략 OK', () => {
    const r = validateProfile({
      totalAmountKrw: 1_000_000,
      maxStages: 5,
      dropPct: 0.03,
      profitPct: 0.05,
    });
    expect(r.ok).toBe(true);
  });

  it('boosterPct 음수 -10% → 통과 (즉시 트리거 의미)', () => {
    const r = validateProfile({
      totalAmountKrw: 1_000_000,
      maxStages: 5,
      dropPct: 0.03,
      profitPct: 0.05,
      boosterPct: -0.05,
    });
    expect(r.ok).toBe(true);
  });
});

import { createStrategyRules, DEFAULT_STRATEGY_PROFILE } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, validateProfile } from './validate';

describe('validateProfile', () => {
  it('기본값은 통과', () => {
    const result = validateProfile(DEFAULT_PROFILE as unknown as Record<string, unknown>);
    expect(result.ok).toBe(true);
  });

  it('buyRules 길이가 maxStages와 다르면 에러', () => {
    const result = validateProfile({
      ...DEFAULT_STRATEGY_PROFILE,
      maxStages: 5,
      buyRules: createStrategyRules(4).buyRules,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.buyRules).toBeTruthy();
    }
  });

  it('1차 buyRule은 triggerDropPct가 없어야 한다', () => {
    const result = validateProfile({
      ...DEFAULT_STRATEGY_PROFILE,
      buyRules: [
        { nth: 1, triggerDropPct: 0.03, amountKrw: 1_000_000 },
        ...DEFAULT_STRATEGY_PROFILE.buyRules.slice(1),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.buyRules).toBeTruthy();
    }
  });

  it('추가 필드가 있어도 전략 검증은 핵심 스키마만 사용한다', () => {
    const result = validateProfile({
      ...DEFAULT_STRATEGY_PROFILE,
      boosterPct: 0.02,
      boosterAmountKrw: 500_000,
    });
    expect(result.ok).toBe(true);
  });
});

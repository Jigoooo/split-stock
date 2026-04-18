import { type StrategyProfile, StrategyProfileSchema } from '@shared/contracts';

export type StrategyFormErrors = Partial<Record<keyof StrategyProfile, string>>;

export const DEFAULT_PROFILE: StrategyProfile = {
  totalAmountKrw: 5_000_000,
  maxStages: 5,
  dropPct: 0.03,
  profitPct: 0.05,
};

/**
 * 폼 값 → StrategyProfile 검증 결과.
 * 필드별 에러 메시지 + 성공 시 parsed profile 반환.
 */
export function validateProfile(
  raw: Record<string, unknown>,
): { ok: true; profile: StrategyProfile } | { ok: false; errors: StrategyFormErrors } {
  const result = StrategyProfileSchema.safeParse(raw);
  if (result.success) return { ok: true, profile: result.data };

  const errors: StrategyFormErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !errors[key as keyof StrategyProfile]) {
      errors[key as keyof StrategyProfile] = issue.message;
    }
  }
  return { ok: false, errors };
}

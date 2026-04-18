import { z } from 'zod';

/**
 * 자동매매 전략 파라미터.
 * - 글로벌 기본(pdno=null)과 종목별 override를 모두 이 스키마로 저장.
 * - boosterPct/boosterAmountKrw는 수익부스터(NM-004) 연동 선택 필드.
 */
export const StrategyProfileSchema = z.object({
  totalAmountKrw: z.number().int().positive(),
  maxStages: z.number().int().min(1).max(20),
  dropPct: z.number().positive().max(0.5),
  profitPct: z.number().positive().max(0.5),
  boosterPct: z.number().min(-0.1).max(0.5).optional(),
  boosterAmountKrw: z.number().int().positive().optional(),
});
export type StrategyProfile = z.infer<typeof StrategyProfileSchema>;

export const StrategyPresetSchema = z.object({
  name: z.string().min(1).max(50),
  profile: StrategyProfileSchema,
});
export type StrategyPreset = z.infer<typeof StrategyPresetSchema>;

import { z } from 'zod';

/**
 * 리스플릿 계획 항목.
 */
export const LotPlanEntrySchema = z.object({
  nth: z.number().int().min(1),
  buyPrice: z.number().int().positive(),
  qty: z.number().int().positive(),
  amountKrw: z.number().int().positive(),
  boughtAt: z.date(),
});
export type LotPlanEntry = z.infer<typeof LotPlanEntrySchema>;

/**
 * 리스플릿 계획.
 */
export const RespiitPlanSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/),
  entries: z.array(LotPlanEntrySchema),
});
export type RespiitPlan = z.infer<typeof RespiitPlanSchema>;

/**
 * 자동매매 전략 파라미터.
 * - 글로벌 기본(pdno=null)과 종목별 override를 모두 이 스키마로 저장.
 * - boosterPct/boosterAmountKrw는 수익부스터(NM-004) 연동 선택 필드.
 * - respiitPlan는 리스플릿 계획 (선택 필드).
 * - autoTradingEnabled는 자동매매 활성화 여부.
 */
export const StrategyProfileSchema = z.object({
  totalAmountKrw: z.number().int().positive(),
  maxStages: z.number().int().min(1).max(20),
  dropPct: z.number().positive().max(0.5),
  profitPct: z.number().positive().max(0.5),
  autoBuyEnabled: z.boolean().default(true),
  autoBuyOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  autoSellEnabled: z.boolean().default(true),
  autoSellOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  boosterPct: z.number().min(-0.1).max(0.5).optional(),
  boosterAmountKrw: z.number().int().positive().optional(),
  respiitPlan: RespiitPlanSchema.optional(),
  autoTradingEnabled: z.boolean().optional(),
});
export type StrategyProfile = z.infer<typeof StrategyProfileSchema>;

export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = {
  totalAmountKrw: 5_000_000,
  maxStages: 5,
  dropPct: 0.03,
  profitPct: 0.05,
  autoBuyEnabled: true,
  autoBuyOrderType: 'LIMIT',
  autoSellEnabled: true,
  autoSellOrderType: 'LIMIT',
};

export const StrategyPresetSchema = z.object({
  name: z.string().min(1).max(50),
  profile: StrategyProfileSchema,
});
export type StrategyPreset = z.infer<typeof StrategyPresetSchema>;

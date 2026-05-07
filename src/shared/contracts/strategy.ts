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

export const MAX_STRATEGY_STAGES = 50;

const StageNthSchema = z.number().int().min(1).max(MAX_STRATEGY_STAGES);
const PercentSchema = z.number().positive().max(0.5);

export const StrategyBuyRuleSchema = z.object({
  nth: StageNthSchema,
  /**
   * 1차는 수동 진입이므로 null.
   * 2차 이후는 직전 차수 대비 하락률(0.03 = 3%).
   */
  triggerDropPct: PercentSchema.nullable(),
  amountKrw: z.number().int().positive(),
});
export type StrategyBuyRule = z.infer<typeof StrategyBuyRuleSchema>;

export const StrategySellRuleSchema = z.object({
  nth: StageNthSchema,
  /** 차수별 익절률(0.05 = 5%). */
  targetProfitPct: PercentSchema,
});
export type StrategySellRule = z.infer<typeof StrategySellRuleSchema>;

/**
 * NM-004 수익 부스터 설정.
 * 1차 전량 매도 후 lastFilledPrice * (1 - dropPct) 도달 시 1차 재매수.
 * dropPct <= 0 이면 즉시 트리거 (홀딩 유지 효과).
 * amountKrw: 재매수 금액. null/undefined 면 buyRules[0].amountKrw 사용.
 */
export const ProfitBoosterSchema = z.object({
  enabled: z.boolean().default(false),
  /** 재매수 트리거 하락률 (0.01 = 1%). 0 이하면 즉시 트리거. */
  dropPct: z.number().default(0),
  /** 만료 시간 (ms 절대시각). 미지정 시 만료 없음 (다음 재시작까지). */
  expiresAt: z.number().int().nullable().default(null),
});
export type ProfitBoosterConfig = z.infer<typeof ProfitBoosterSchema>;

const StrategyProfileBaseSchema = z.object({
  version: z.literal(2).default(2),
  maxStages: z.number().int().min(1).max(MAX_STRATEGY_STAGES),
  buyRules: z.array(StrategyBuyRuleSchema).min(1).max(MAX_STRATEGY_STAGES),
  sellRules: z.array(StrategySellRuleSchema).min(1).max(MAX_STRATEGY_STAGES),
  autoBuyEnabled: z.boolean().default(false),
  autoBuyOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  autoSellEnabled: z.boolean().default(false),
  autoSellOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  respiitPlan: RespiitPlanSchema.optional(),
  autoTradingEnabled: z.boolean().optional(),
  /** NM-004 수익 부스터 설정 — optional 로 기존 저장값과 호환. */
  profitBooster: ProfitBoosterSchema.optional(),
});

/**
 * 자동매매 전략 파라미터.
 * - 글로벌 기본(pdno=null)과 종목별 override를 모두 이 스키마로 저장.
 * - 1차는 수동 진입. 따라서 buyRules[0].triggerDropPct는 항상 null이다.
 * - 2차~N차는 직전 차수 대비 하락률 + 해당 차수 매수금액으로 정의한다.
 * - sellRules는 1차~N차 차수별 익절률을 가진다.
 */
export const StrategyProfileSchema = StrategyProfileBaseSchema.superRefine((profile, ctx) => {
  if (profile.buyRules.length < profile.maxStages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['buyRules'],
      message: 'buyRules는 활성 maxStages 이상 채워야 합니다.',
    });
  }
  if (profile.sellRules.length < profile.maxStages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sellRules'],
      message: 'sellRules는 활성 maxStages 이상 채워야 합니다.',
    });
  }

  for (let index = 0; index < profile.buyRules.length; index += 1) {
    const nth = index + 1;
    const buyRule = profile.buyRules[nth - 1];

    if (!buyRule || buyRule.nth !== nth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyRules'],
        message: 'buyRules nth는 1차부터 저장된 차수까지 순서대로 채워야 합니다.',
      });
      break;
    }
    if (nth === 1 && buyRule.triggerDropPct !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyRules', nth - 1, 'triggerDropPct'],
        message: '1차는 수동 진입이므로 triggerDropPct가 없어야 합니다.',
      });
    }
    if (nth > 1 && buyRule.triggerDropPct === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyRules', nth - 1, 'triggerDropPct'],
        message: '2차 이후는 triggerDropPct가 필요합니다.',
      });
    }
  }

  for (let index = 0; index < profile.sellRules.length; index += 1) {
    const nth = index + 1;
    const sellRule = profile.sellRules[nth - 1];

    if (!sellRule || sellRule.nth !== nth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sellRules'],
        message: 'sellRules nth는 1차부터 저장된 차수까지 순서대로 채워야 합니다.',
      });
      break;
    }
  }
});
export type StrategyProfile = z.infer<typeof StrategyProfileSchema>;

const DEFAULT_STAGE_AMOUNT = 1_000_000;
const DEFAULT_DROP_PCT = 0.03;
const DEFAULT_PROFIT_PCT = 0.05;

export function createStrategyRules(
  maxStages: number = MAX_STRATEGY_STAGES,
  opts: {
    amountKrw?: number;
    dropPct?: number;
    profitPct?: number;
  } = {},
): Pick<StrategyProfile, 'buyRules' | 'sellRules'> {
  const amountKrw = opts.amountKrw ?? DEFAULT_STAGE_AMOUNT;
  const dropPct = opts.dropPct ?? DEFAULT_DROP_PCT;
  const profitPct = opts.profitPct ?? DEFAULT_PROFIT_PCT;

  return {
    buyRules: Array.from({ length: maxStages }, (_, index) => ({
      nth: index + 1,
      triggerDropPct: index === 0 ? null : dropPct,
      amountKrw,
    })),
    sellRules: Array.from({ length: maxStages }, (_, index) => ({
      nth: index + 1,
      targetProfitPct: profitPct,
    })),
  };
}

export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = {
  version: 2,
  maxStages: 5,
  ...createStrategyRules(MAX_STRATEGY_STAGES),
  autoBuyEnabled: false,
  autoBuyOrderType: 'LIMIT',
  autoSellEnabled: false,
  autoSellOrderType: 'LIMIT',
};

export const LegacyStrategyProfileSchema = z.object({
  totalAmountKrw: z.number().int().positive(),
  maxStages: z.number().int().min(1).max(20),
  dropPct: PercentSchema,
  profitPct: PercentSchema,
  autoBuyEnabled: z.boolean().default(false),
  autoBuyOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  autoSellEnabled: z.boolean().default(false),
  autoSellOrderType: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
  respiitPlan: RespiitPlanSchema.optional(),
  autoTradingEnabled: z.boolean().optional(),
});
export type LegacyStrategyProfile = z.infer<typeof LegacyStrategyProfileSchema>;

export type StrategyAutoMode = 'ALL_ON' | 'ALL_OFF' | 'BUY_ONLY' | 'SELL_ONLY';
export type StrategyOrderType = StrategyProfile['autoBuyOrderType'];

export function deriveStrategyAutoMode(
  profile: Pick<StrategyProfile, 'autoBuyEnabled' | 'autoSellEnabled'>,
): StrategyAutoMode {
  if (profile.autoBuyEnabled && profile.autoSellEnabled) return 'ALL_ON';
  if (!profile.autoBuyEnabled && !profile.autoSellEnabled) return 'ALL_OFF';
  return profile.autoBuyEnabled ? 'BUY_ONLY' : 'SELL_ONLY';
}

export function applyStrategyAutoMode(
  profile: StrategyProfile,
  mode: StrategyAutoMode,
): StrategyProfile {
  switch (mode) {
    case 'ALL_ON':
      return { ...profile, autoBuyEnabled: true, autoSellEnabled: true };
    case 'ALL_OFF':
      return { ...profile, autoBuyEnabled: false, autoSellEnabled: false };
    case 'BUY_ONLY':
      return { ...profile, autoBuyEnabled: true, autoSellEnabled: false };
    case 'SELL_ONLY':
      return { ...profile, autoBuyEnabled: false, autoSellEnabled: true };
  }
}

export function deriveTotalAmountKrw(
  profile: Pick<StrategyProfile, 'buyRules'> & Partial<Pick<StrategyProfile, 'maxStages'>>,
): number {
  const activeLength = profile.maxStages ?? profile.buyRules.length;
  return profile.buyRules.slice(0, activeLength).reduce((sum, rule) => sum + rule.amountKrw, 0);
}

export function normalizeStrategyProfile(input: unknown): StrategyProfile | null {
  const next = StrategyProfileBaseSchema.safeParse(input);
  if (next.success) {
    return expandStrategyRules(next.data);
  }

  const legacy = LegacyStrategyProfileSchema.safeParse(input);
  if (!legacy.success) return null;

  const amountKrw = Math.max(1, Math.floor(legacy.data.totalAmountKrw / legacy.data.maxStages));
  return normalizeStrategyProfile({
    version: 2,
    maxStages: legacy.data.maxStages,
    ...createStrategyRules(legacy.data.maxStages, {
      amountKrw,
      dropPct: legacy.data.dropPct,
      profitPct: legacy.data.profitPct,
    }),
    autoBuyEnabled: legacy.data.autoBuyEnabled,
    autoBuyOrderType: legacy.data.autoBuyOrderType,
    autoSellEnabled: legacy.data.autoSellEnabled,
    autoSellOrderType: legacy.data.autoSellOrderType,
    ...(legacy.data.respiitPlan ? { respiitPlan: legacy.data.respiitPlan } : {}),
    ...(legacy.data.autoTradingEnabled !== undefined
      ? { autoTradingEnabled: legacy.data.autoTradingEnabled }
      : {}),
  });
}

export function migrateLegacyStrategyProfile(input: unknown): StrategyProfile | null {
  return normalizeStrategyProfile(input);
}

function expandStrategyRules(
  profile: z.infer<typeof StrategyProfileBaseSchema>,
): StrategyProfile | null {
  const defaults = createStrategyRules(MAX_STRATEGY_STAGES);
  const buyRules = defaults.buyRules.map((fallback, index) => {
    const nth = index + 1;
    const existing = profile.buyRules[index];
    return {
      nth,
      triggerDropPct: nth === 1 ? null : (existing?.triggerDropPct ?? fallback.triggerDropPct),
      amountKrw: existing?.amountKrw ?? fallback.amountKrw,
    };
  });
  const sellRules = defaults.sellRules.map((fallback, index) => {
    const nth = index + 1;
    const existing = profile.sellRules[index];
    return {
      nth,
      targetProfitPct: existing?.targetProfitPct ?? fallback.targetProfitPct,
    };
  });
  const parsed = StrategyProfileSchema.safeParse({
    ...profile,
    buyRules,
    sellRules,
  });
  return parsed.success ? parsed.data : null;
}

export const StrategyPresetSchema = z.object({
  name: z.string().min(1).max(50),
  profile: StrategyProfileSchema,
});
export type StrategyPreset = z.infer<typeof StrategyPresetSchema>;

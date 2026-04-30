import { z } from 'zod';
import type { EvidenceRef } from '../magic-split-facts';

const RawBuyRuleSchema = z.object({
  nth: z.number().int().min(1).max(50),
  /** 1차는 null. 2차+ 는 직전 차수 대비 하락률 (0.03 = 3%). */
  triggerDropPct: z.number().min(0.001).max(0.5).nullable(),
  /** 차수당 매수 금액 (원). */
  amountKrw: z.number().int().min(10000),
});

const RawSellRuleSchema = z.object({
  nth: z.number().int().min(1).max(50),
  targetProfitPct: z.number().min(0.005).max(0.5),
});

export const StrategySuggestionSchema = z.object({
  maxStages: z.number().int().min(2).max(20),
  buyRules: z.array(RawBuyRuleSchema).min(2),
  sellRules: z.array(RawSellRuleSchema).min(2),
  reasoning: z.string().min(1).max(400),
  stageRationales: z
    .array(
      z.object({
        nth: z.number().int().min(1).max(50),
        rationale: z.string().min(1).max(300),
        evidenceRefs: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  globalRisks: z.array(z.string()).max(8).default([]),
  evidenceRefs: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['indicator', 'news', 'disclosure', 'market', 'dataQuality']),
        title: z.string(),
        detail: z.string(),
      }),
    )
    .default([]),
  analysisConfidence: z.enum(['high', 'med', 'low']).default('low'),
  dataQuality: z.enum(['blocked', 'limited', 'normal']).default('blocked'),
});

export type StrategySuggestion = z.infer<typeof StrategySuggestionSchema>;

export const LenientStrategySuggestionSchema = z.object({
  maxStages: normalizeIntSchema(2, 20),
  buyRules: z.array(
    z.object({
      nth: normalizeIntSchema(1, 50),
      triggerDropPct: normalizeNullableRatioSchema(0.001, 0.5),
      amountKrw: normalizeIntSchema(10000),
    }),
  ),
  sellRules: z.array(
    z.object({
      nth: normalizeIntSchema(1, 50),
      targetProfitPct: normalizeRatioSchema(0.005, 0.5),
    }),
  ),
  reasoning: normalizeTextSchema(400),
  stageRationales: z
    .array(
      z.object({
        nth: normalizeIntSchema(1, 50),
        rationale: normalizeTextSchema(300),
        evidenceRefs: normalizeStringArraySchema(),
      }),
    )
    .default([]),
  globalRisks: z.array(normalizeTextSchema(140)).max(8).default([]),
  evidenceRefs: z
    .array(
      z.object({
        id: normalizeTextSchema(120),
        kind: normalizeEvidenceKindSchema(),
        title: normalizeTextSchema(160),
        detail: normalizeTextSchema(300),
      }),
    )
    .default([]),
  analysisConfidence: normalizeConfidenceSchema(),
  dataQuality: normalizeDataQualitySchema(),
}) satisfies z.ZodType<StrategySuggestion>;

function normalizeIntSchema(min: number, max = Number.MAX_SAFE_INTEGER): z.ZodType<number> {
  return z.preprocess((value) => {
    if (typeof value === 'number') return Math.round(value);
    if (typeof value !== 'string') return value;
    const normalized = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(normalized) ? Math.round(normalized) : value;
  }, z.number().int().min(min).max(max));
}

function normalizeNullableRatioSchema(min: number, max: number): z.ZodType<number | null> {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (!lower || lower === 'null' || lower === 'none' || lower.includes('수동')) return null;
    }
    return normalizeRatioValue(value);
  }, z.number().min(min).max(max).nullable());
}

function normalizeRatioSchema(min: number, max: number): z.ZodType<number> {
  return z.preprocess((value) => normalizeRatioValue(value), z.number().min(min).max(max));
}

function normalizeRatioValue(value: unknown): unknown {
  let numeric: number;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const normalized = Number(value.replace(/[%％,\s]/g, ''));
    if (!Number.isFinite(normalized)) return value;
    numeric = normalized;
  } else {
    return value;
  }
  return numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
}

function normalizeTextSchema(max: number): z.ZodType<string> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    return value.trim().slice(0, max);
  }, z.string().min(1).max(max));
}

function normalizeStringArraySchema(): z.ZodType<string[]> {
  return z
    .preprocess((value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'id' in item) return String(item.id);
          return null;
        })
        .filter((item): item is string => item !== null);
    }, z.array(z.string()))
    .default([]);
}

function normalizeEvidenceKindSchema(): z.ZodType<EvidenceRef['kind']> {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return 'market';
      const lower = value.toLowerCase();
      if (lower.includes('indicator') || lower.includes('지표')) return 'indicator';
      if (lower.includes('news') || lower.includes('뉴스')) return 'news';
      if (lower.includes('disclosure') || lower.includes('dart') || lower.includes('공시')) {
        return 'disclosure';
      }
      if (lower.includes('quality') || lower.includes('품질')) return 'dataQuality';
      return 'market';
    },
    z.enum(['indicator', 'news', 'disclosure', 'market', 'dataQuality']),
  );
}

function normalizeConfidenceSchema(): z.ZodType<StrategySuggestion['analysisConfidence']> {
  return z
    .preprocess(
      (value) => {
        if (typeof value !== 'string') return 'low';
        const lower = value.toLowerCase();
        if (lower === 'high' || lower.includes('높')) return 'high';
        if (lower === 'med' || lower === 'medium' || lower.includes('중')) return 'med';
        return 'low';
      },
      z.enum(['high', 'med', 'low']),
    )
    .default('low');
}

function normalizeDataQualitySchema(): z.ZodType<StrategySuggestion['dataQuality']> {
  return z
    .preprocess(
      (value) => {
        if (typeof value !== 'string') return 'blocked';
        const lower = value.toLowerCase();
        if (lower === 'normal' || lower.includes('정상')) return 'normal';
        if (lower === 'limited' || lower.includes('제한')) return 'limited';
        return 'blocked';
      },
      z.enum(['blocked', 'limited', 'normal']),
    )
    .default('blocked');
}

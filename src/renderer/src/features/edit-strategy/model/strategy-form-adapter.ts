import {
  applyStrategyAutoMode,
  DEFAULT_STRATEGY_PROFILE,
  deriveStrategyAutoMode,
  MAX_STRATEGY_STAGES,
  normalizeStrategyProfile,
  type StrategyProfile,
} from '@shared/contracts';
import type { FormRaw, StageRuleRowRaw } from './strategy-form-types';

function resolveProfile(profile: StrategyProfile | null): StrategyProfile {
  return normalizeStrategyProfile(profile) ?? DEFAULT_STRATEGY_PROFILE;
}

export function toStageRows(profile: StrategyProfile | null): StageRuleRowRaw[] {
  const resolved = resolveProfile(profile);
  return Array.from({ length: MAX_STRATEGY_STAGES }, (_, index) => {
    const nth = index + 1;
    const buyRule = resolved.buyRules[index] ?? DEFAULT_STRATEGY_PROFILE.buyRules[index];
    const sellRule = resolved.sellRules[index] ?? DEFAULT_STRATEGY_PROFILE.sellRules[index];
    return {
      nth,
      amountKrw: String(buyRule?.amountKrw ?? 1_000_000),
      targetProfitPct: String(((sellRule?.targetProfitPct ?? 0.05) * 100).toLocaleString('ko-KR')),
      triggerDropPct:
        nth === 1 ? '' : String(((buyRule?.triggerDropPct ?? 0.03) * 100).toLocaleString('ko-KR')),
    };
  });
}

export function toFormRaw(profile: StrategyProfile | null): FormRaw {
  const resolved = resolveProfile(profile);
  return {
    maxStages: String(resolved.maxStages),
    autoMode: deriveStrategyAutoMode(resolved),
    autoBuyOrderType: resolved.autoBuyOrderType,
    autoSellOrderType: resolved.autoSellOrderType,
  };
}

export function toProfile(
  raw: FormRaw,
  rows: StageRuleRowRaw[],
  initial: StrategyProfile | null,
): Record<string, unknown> {
  const base = resolveProfile(initial);
  return applyStrategyAutoMode(
    {
      version: 2,
      maxStages: Number(raw.maxStages),
      buyRules: rows.map((row, index) => ({
        nth: row.nth,
        triggerDropPct: index === 0 ? null : Number(row.triggerDropPct) / 100,
        amountKrw: Number(row.amountKrw),
      })),
      sellRules: rows.map((row) => ({
        nth: row.nth,
        targetProfitPct: Number(row.targetProfitPct) / 100,
      })),
      autoBuyEnabled: true,
      autoBuyOrderType: raw.autoBuyOrderType,
      autoSellEnabled: true,
      autoSellOrderType: raw.autoSellOrderType,
      ...(base.respiitPlan ? { respiitPlan: base.respiitPlan } : {}),
      ...(base.autoTradingEnabled !== undefined
        ? { autoTradingEnabled: base.autoTradingEnabled }
        : {}),
    },
    raw.autoMode,
  );
}

import { DEFAULT_STRATEGY_PROFILE, StrategyProfileSchema } from '@shared/contracts';
import { buildRangeCycleFacts } from '../range-cycle-facts';
import { buildStrategyEvidenceRefs, fetchDisclosureContext } from './evidence';
import { buildStrategyPrompt, STRATEGY_SYSTEM_PROMPT } from './prompt';
import {
  normalizeSuggestion,
  parseStrategySuggestionLenient,
  previewForLog,
} from './result-mapping';
import { type StrategySuggestion, StrategySuggestionSchema } from './schema';
import type { SuggestStrategyInput, SuggestStrategyResult } from './types';

export async function runSuggestStrategy(
  input: SuggestStrategyInput,
): Promise<SuggestStrategyResult> {
  const startedAt = Date.now();
  const config = input.aiCredentialsRepo.getDefaultWithKey();
  if (!config) {
    return {
      suggestion: null,
      emptyReason: 'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 등록 후 다시 시도하세요.',
      durationMs: 0,
    };
  }

  if (input.ensureCandles) await input.ensureCandles([input.pdno]);

  const facts = buildRangeCycleFacts({
    candlesRepo: input.candlesRepo,
    pdnos: [input.pdno],
    marketContextByPdno: () => input.marketContext ?? null,
  })[0];
  const stat = facts?.stat;
  if (!facts || facts.dataQuality === 'blocked' || !stat) {
    return {
      suggestion: null,
      emptyReason: `일봉 캐시가 부족합니다 (${facts?.dataQualityReason ?? stat?.dataReason ?? 'no-data'}). 차트를 한 번 열어 봉을 받아온 뒤 재시도하세요.`,
      durationMs: Date.now() - startedAt,
      dataQuality: facts?.dataQuality ?? 'blocked',
      dataQualityReason: facts?.dataQualityReason ?? '데이터 없음',
    };
  }

  const stockMaster = input.stockMasterRepo.find(input.pdno);
  const stockName = stockMaster?.name ?? input.pdno;
  const { disclosuresLine, disclosureRefs } = await fetchDisclosureContext(input);
  const desiredStages = input.desiredStages ?? 5;
  const maxAllowedStages =
    facts.dataQuality === 'limited' ? Math.min(desiredStages, 3) : desiredStages;
  const evidenceRefs = buildStrategyEvidenceRefs(facts, disclosureRefs, input);
  const userPrompt = buildStrategyPrompt({
    input,
    stockName,
    facts,
    maxAllowedStages,
    evidenceRefs,
    disclosuresLine,
  });

  const result = await input.llmClient.chat({
    config,
    schema: StrategySuggestionSchema,
    schemaName: 'AiStrategySuggestion',
    maxOutputTokens: 3500,
    messages: [
      { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const rawSuggestion = recoverParsedSuggestion(result, input, config);
  if (!rawSuggestion) {
    const failure = parseStrategySuggestionLenient(result.text);
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.parse-failed',
      payload: {
        rawChars: result.text.length,
        pdno: input.pdno,
        provider: config.provider,
        model: config.model,
        toolCalls: result.toolCalls.length,
        issues: failure.issues.slice(0, 8),
        rawPreview: previewForLog(result.text),
      },
    });
    return {
      suggestion: null,
      emptyReason: 'AI 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.',
      durationMs: Date.now() - startedAt,
    };
  }

  const suggestion = normalizeSuggestion(rawSuggestion.suggestion, facts.dataQuality, evidenceRefs);
  const draftValidation = StrategyProfileSchema.safeParse({
    ...DEFAULT_STRATEGY_PROFILE,
    maxStages: suggestion.maxStages,
    buyRules: suggestion.buyRules.map((rule) => ({
      nth: rule.nth,
      triggerDropPct: rule.nth === 1 ? null : rule.triggerDropPct,
      amountKrw: rule.amountKrw,
    })),
    sellRules: suggestion.sellRules.map((rule) => ({
      nth: rule.nth,
      targetProfitPct: rule.targetProfitPct,
    })),
  });
  if (!draftValidation.success) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.draft-invalid',
      payload: {
        pdno: input.pdno,
        provider: config.provider,
        model: config.model,
        issues: draftValidation.error.issues.slice(0, 3).map((issue) => issue.message),
      },
    });
    return {
      suggestion: null,
      emptyReason: 'AI 제안이 검증을 통과하지 못했습니다. 다시 시도하거나 수동으로 입력하세요.',
      durationMs: Date.now() - startedAt,
    };
  }

  input.logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'ai.suggest-strategy.ok',
    payload: {
      pdno: input.pdno,
      provider: config.provider,
      model: config.model,
      maxStages: suggestion.maxStages,
      durationMs: Date.now() - startedAt,
      parseRecovered: rawSuggestion.parseRecovered,
    },
  });
  return {
    suggestion,
    emptyReason: null,
    durationMs: Date.now() - startedAt,
    dataQuality: facts.dataQuality,
    dataQualityReason: facts.dataQualityReason,
  };
}

function recoverParsedSuggestion(
  result: {
    parsed: StrategySuggestion | null;
    text: string;
    toolCalls: ReadonlyArray<unknown>;
  },
  input: SuggestStrategyInput,
  config: { provider: string; model: string },
): { suggestion: StrategySuggestion; parseRecovered: boolean } | null {
  if (result.parsed) return { suggestion: result.parsed, parseRecovered: false };
  const recovered = parseStrategySuggestionLenient(result.text);
  if (!recovered.suggestion) return null;
  input.logger.log({
    level: 'WARN',
    category: 'SYS',
    message: 'ai.suggest-strategy.parse-recovered',
    payload: {
      pdno: input.pdno,
      provider: config.provider,
      model: config.model,
      rawChars: result.text.length,
      toolCalls: result.toolCalls.length,
      issues: recovered.issues.slice(0, 6),
    },
  });
  return { suggestion: recovered.suggestion, parseRecovered: true };
}

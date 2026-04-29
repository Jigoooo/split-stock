import { DEFAULT_STRATEGY_PROFILE, StrategyProfileSchema } from '@shared/contracts';
import { z } from 'zod';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { AiCredentialsRepo } from './ai-credentials-repo';
import type { DartClient } from './dart-client';
import type { LlmClient } from './llm-client';
import { buildMagicSplitFacts, type DataQuality, type EvidenceRef } from './magic-split-facts';
import { formatNewsEvidenceForPrompt, type NewsEvidencePack } from './news-evidence';
import type { RankedMarketContext } from './suggest-symbols';

export interface SuggestStrategyInput {
  pdno: string;
  candlesRepo: DailyCandlesRepo;
  stockMasterRepo: StockMasterRepo;
  aiCredentialsRepo: AiCredentialsRepo;
  llmClient: LlmClient;
  dartClient: DartClient;
  logger: EventLogger;
  /** 후보 차수 max — 기본 5. */
  desiredStages?: number;
  /** DART corp_code 입력 — 외부에서 주입 가능 (corpCode lookup 미구현 시 fallback). */
  corpCode?: string;
  newsEvidence?: NewsEvidencePack;
  marketContext?: RankedMarketContext | null;
  /**
   * 일봉 캐시 사전 보충 콜백. 호출자(ai-router)가 KIS env/auth 들고 주입.
   * 미주입 시 캐시만 사용.
   */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
}

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

const StrategySuggestionSchema = z.object({
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

export interface SuggestStrategyResult {
  suggestion: StrategySuggestion | null;
  emptyReason: string | null;
  durationMs: number;
  dataQuality?: DataQuality;
  dataQualityReason?: string;
}

/**
 * 종목별 매직스플릿 strategy 추천.
 *
 * 흐름:
 *   1) 일봉(60/120일) 통계 산출 (변동성·평균거래량·박스권)
 *   2) DART 최근 30일 공시 제목 fetch (있으면 LLM 컨텍스트에 포함, 실패해도 진행)
 *   3) default AI config 로 LLM 호출 + JSON schema 강제
 *   4) 결과는 호출측에서 StrategyProfile 로 변환 후 validateProfile 통과 검증
 *
 * 주의:
 *   - 데이터 부족(일봉 캐시 < 30개) 시 emptyReason 만 반환 — LLM 비용 낭비 방지.
 *   - 응답 JSON 파싱 실패 시 retry 없이 emptyReason 으로 마무리.
 */
export async function suggestStrategy(input: SuggestStrategyInput): Promise<SuggestStrategyResult> {
  const startedAt = Date.now();
  const config = input.aiCredentialsRepo.getDefaultWithKey();
  if (!config) {
    return {
      suggestion: null,
      emptyReason: 'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 등록 후 다시 시도하세요.',
      durationMs: 0,
    };
  }

  // 일봉 캐시 부족 시 자동 fetch — 차트 사전 오픈 없이도 strategy 추천 동작.
  if (input.ensureCandles) {
    await input.ensureCandles([input.pdno]);
  }

  const facts = buildMagicSplitFacts({
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

  // DART — 실패해도 LLM 호출은 계속.
  let disclosuresLine = '';
  let disclosureRefs: EvidenceRef[] = [];
  if (input.corpCode && input.dartClient.isAvailable()) {
    const recent = await input.dartClient.listRecentDisclosures(input.corpCode, 30, 8);
    if (recent.length > 0) {
      disclosureRefs = recent.map((d, index) => ({
        id: `disclosure:${d.rceptNo || d.rceptDt}:${index + 1}`,
        kind: 'disclosure',
        title: d.reportNm,
        detail: `${d.rceptDt} 접수번호 ${d.rceptNo}`,
      }));
      disclosuresLine = `\n최근 30일 공시(${recent.length}건):\n${disclosureRefs.map((d) => `- [${d.id}] ${d.detail}: ${d.title}`).join('\n')}`;
    }
  }

  const desiredStages = input.desiredStages ?? 5;
  const maxAllowedStages =
    facts.dataQuality === 'limited' ? Math.min(desiredStages, 3) : desiredStages;
  const evidenceRefs: EvidenceRef[] = [
    {
      id: `data:${facts.dataQuality}`,
      kind: 'dataQuality',
      title: facts.dataQuality === 'limited' ? '제한 분석' : '정상 분석',
      detail: facts.dataQualityReason,
    } satisfies EvidenceRef,
    ...facts.evidenceRefs,
    ...disclosureRefs,
    ...(input.newsEvidence?.clusters ?? []).map(
      (cluster): EvidenceRef => ({
        id: cluster.id,
        kind: 'news' as const,
        title: cluster.title,
        detail: cluster.summary,
      }),
    ),
  ].slice(0, 16);
  const userPrompt = [
    `종목: ${stockName} (${input.pdno})`,
    `데이터 품질: ${facts.dataQuality} (${facts.dataQualityReason}), analysisConfidence=${facts.analysisConfidence}`,
    `최근 종가: ${stat.lastClose ?? 'n/a'} 원`,
    `60일 연환산 변동성: ${stat.volatility60d ?? 'n/a'}%`,
    `60일 평균 거래량: ${stat.avgVolume60d ?? 'n/a'} 주`,
    `120일 박스권 폭: ${stat.rangePct120d ?? 'n/a'}%`,
    `알고리즘 신호: score=${facts.algo.splitScore ?? 'n/a'}, consensus=${facts.algo.consensusLevel}/${facts.algo.consensusDirection}(${facts.algo.consensusCount}), confidence=${facts.algo.confidence}`,
    facts.algo.conflicts.length > 0 ? `충돌 신호: ${facts.algo.conflicts.join(' / ')}` : '',
    facts.algo.indicatorReasons.length > 0
      ? `지표 근거: ${facts.algo.indicatorReasons
          .map((r) => `[${r.indicator}] ${r.value} - ${r.meaning}`)
          .join(' / ')}`
      : '',
    input.marketContext
      ? `시장 컨텍스트: ${JSON.stringify(input.marketContext).slice(0, 1200)}`
      : '',
    formatNewsEvidenceForPrompt(input.newsEvidence, 2400),
    disclosuresLine,
    '',
    `위 통계를 기반으로 매직스플릿 ${maxAllowedStages}차 전략을 설계해 주세요.`,
    '',
    '제약:',
    `- maxStages: 2~${maxAllowedStages} 범위. dataQuality=limited 이면 반드시 3 이하.`,
    '- buyRules[0].triggerDropPct 는 반드시 null (1차는 수동 진입)',
    '- buyRules[1..].triggerDropPct: **직전 차수 매수가 대비** 하락률 (0.02 = 2%, 0.03 = 3% 등).',
    '  ⚠ 1차 가격 누적 기준이 아니라 매번 직전 차수 가격에서 추가로 N% 하락. 복리로 누적됨.',
    '  예) 1차 10,000원 매수 + triggerDropPct 0.03(3%) → 2차 트리거: 10,000×0.97=9,700원. 3차 트리거: 9,700×0.97=9,409원 (1차 대비 -5.91%).',
    '  따라서 차수가 깊어질수록 triggerDropPct 자체를 키울 필요는 거의 없다. 일반적으로 0.02~0.04 정도로 비교적 균일하게 분포.',
    '  ❌ 잘못된 패턴 예: 2차 0.05, 3차 0.07, 4차 0.09, 5차 0.11 — 이는 "1차 대비 누적 -5/-7/-9/-11%"를 직전 대비로 오인한 결과. 직전 대비로 +2%씩 단조 증가시키지 말 것.',
    '  ✅ 권장 패턴 예: 박스권 폭 30% / 변동성 35% 종목이라면 직전 대비 0.03~0.04 정도 균일하게.',
    '- amountKrw: 모든 차수 동일 또는 점증 (예: 차수 늘수록 더 큰 금액으로 평단가 빠르게 낮춤)',
    '- sellRules[i].targetProfitPct: 차수별 익절률. 보통 후순위 차수가 더 작은 익절(빠른 회수)',
    '- dataQuality=limited 에서는 triggerDropPct 0.02~0.035, targetProfitPct 0.015~0.04, amountKrw 는 1차 대비 최대 1.5배까지만 허용.',
    '- reasoning: 추천 근거 1~2 문장 (한국어, 400자 이내)',
    '- stageRationales: 차수별 rationale 과 evidenceRefs(id 문자열)를 채움.',
    '- globalRisks: 데이터 부족/뉴스 충돌/지표 충돌 등 전역 리스크.',
    '- evidenceRefs: 아래 evidence 후보 중 사용한 id/title/detail 을 보존.',
    `evidence candidates: ${JSON.stringify(evidenceRefs).slice(0, 2500)}`,
    '',
    '응답 JSON schema:',
    '{"maxStages":int,"buyRules":[{"nth":int,"triggerDropPct":number|null,"amountKrw":int}],"sellRules":[{"nth":int,"targetProfitPct":number}],"reasoning":"...","stageRationales":[{"nth":int,"rationale":"...","evidenceRefs":["..."]}],"globalRisks":["..."],"evidenceRefs":[{"id":"...","kind":"indicator|news|disclosure|market|dataQuality","title":"...","detail":"..."}],"analysisConfidence":"high|med|low","dataQuality":"blocked|limited|normal"}',
  ].join('\n');

  const result = await input.llmClient.chat({
    config,
    schema: StrategySuggestionSchema,
    schemaName: 'AiStrategySuggestion',
    maxOutputTokens: 2200,
    messages: [
      {
        role: 'system',
        content: [
          '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 설계 보조입니다.',
          '응답은 단일 JSON 객체로만 답하고, 차수 nth 는 1부터 maxStages 까지 순서대로 채우세요.',
          '핵심: triggerDropPct 는 "직전 차수 매수가 × (1 - triggerDropPct)" 로 다음 차수 트리거를 산출한다. 1차 가격 누적이 아니다.',
          '따라서 모든 차수에서 비교적 균일한 값(0.02~0.04)이 자연스러우며, 차수가 늘어난다고 해서 triggerDropPct 를 +0.02 씩 단조 증가시키면 안 된다.',
        ].join('\n'),
      },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!result.parsed) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.parse-failed',
      payload: { rawChars: result.text.length, pdno: input.pdno },
    });
    return {
      suggestion: null,
      emptyReason: 'AI 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.',
      durationMs: Date.now() - startedAt,
    };
  }

  const suggestion = normalizeSuggestion(result.parsed, facts.dataQuality, evidenceRefs);

  // dry-run StrategyProfileSchema 검증 — renderer 가 mergeIntoProfile 후 적용 시 기존
  // validateProfile 에서 실패할 케이스를 사전에 차단해 "적용" 클릭 후 실패 UX 를 방지.
  const draftProfile = {
    ...DEFAULT_STRATEGY_PROFILE,
    maxStages: suggestion.maxStages,
    buyRules: suggestion.buyRules.map((r) => ({
      nth: r.nth,
      triggerDropPct: r.nth === 1 ? null : r.triggerDropPct,
      amountKrw: r.amountKrw,
    })),
    sellRules: suggestion.sellRules.map((r) => ({
      nth: r.nth,
      targetProfitPct: r.targetProfitPct,
    })),
  };
  const draftValidation = StrategyProfileSchema.safeParse(draftProfile);
  if (!draftValidation.success) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.draft-invalid',
      payload: {
        pdno: input.pdno,
        provider: config.provider,
        model: config.model,
        issues: draftValidation.error.issues.slice(0, 3).map((i) => i.message),
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

/**
 * LLM 응답을 정규화 — buyRules[0].triggerDropPct=null 강제, nth 정렬, maxStages 와 길이 일치.
 */
function normalizeSuggestion(
  raw: StrategySuggestion,
  dataQuality: DataQuality,
  fallbackEvidenceRefs: ReadonlyArray<EvidenceRef>,
): StrategySuggestion {
  const sortedBuy = [...raw.buyRules].sort((a, b) => a.nth - b.nth);
  const sortedSell = [...raw.sellRules].sort((a, b) => a.nth - b.nth);
  if (sortedBuy.length > 0) {
    const first = sortedBuy[0];
    if (first) sortedBuy[0] = { ...first, nth: 1, triggerDropPct: null };
  }
  // nth 재라벨링 — LLM 이 비순차 응답해도 1..N 강제.
  for (let i = 0; i < sortedBuy.length; i++) {
    const item = sortedBuy[i];
    if (item) sortedBuy[i] = { ...item, nth: i + 1 };
  }
  for (let i = 0; i < sortedSell.length; i++) {
    const item = sortedSell[i];
    if (item) sortedSell[i] = { ...item, nth: i + 1 };
  }
  // maxStages 와 buyRules 길이 일치 — 부족하면 잘라내기.
  const maxStages = Math.min(
    dataQuality === 'limited' ? 3 : raw.maxStages,
    raw.maxStages,
    sortedBuy.length,
    sortedSell.length,
  );
  const buyRules = sortedBuy.slice(0, maxStages).map((rule, index) => {
    if (dataQuality !== 'limited' || index === 0) return rule;
    return {
      ...rule,
      triggerDropPct:
        rule.triggerDropPct === null ? 0.02 : Math.max(0.02, Math.min(0.035, rule.triggerDropPct)),
      amountKrw: Math.min(
        rule.amountKrw,
        Math.round((sortedBuy[0]?.amountKrw ?? rule.amountKrw) * 1.5),
      ),
    };
  });
  const sellRules = sortedSell
    .slice(0, maxStages)
    .map((rule) =>
      dataQuality === 'limited'
        ? { ...rule, targetProfitPct: Math.max(0.015, Math.min(0.04, rule.targetProfitPct)) }
        : rule,
    );
  return {
    maxStages,
    buyRules,
    sellRules,
    reasoning: raw.reasoning,
    stageRationales: normalizeStageRationales(raw.stageRationales, maxStages, fallbackEvidenceRefs),
    globalRisks: raw.globalRisks.slice(0, 8),
    evidenceRefs: normalizeEvidenceRefs(raw.evidenceRefs, fallbackEvidenceRefs),
    analysisConfidence: dataQuality === 'limited' ? 'low' : raw.analysisConfidence,
    dataQuality,
  };
}

function normalizeEvidenceRefs(
  rawRefs: ReadonlyArray<EvidenceRef>,
  fallbackRefs: ReadonlyArray<EvidenceRef>,
): EvidenceRef[] {
  const fallbackById = new Map(fallbackRefs.map((ref) => [ref.id, ref]));
  const grounded = rawRefs
    .map((ref) => fallbackById.get(ref.id))
    .filter((ref): ref is EvidenceRef => ref !== undefined);
  return grounded.length > 0 ? dedupeEvidenceRefs(grounded) : [...fallbackRefs];
}

function normalizeStageRationales(
  rawRationales: StrategySuggestion['stageRationales'],
  maxStages: number,
  fallbackRefs: ReadonlyArray<EvidenceRef>,
): StrategySuggestion['stageRationales'] {
  const knownIds = new Set(fallbackRefs.map((ref) => ref.id));
  return rawRationales.slice(0, maxStages).map((item, index) => ({
    ...item,
    nth: index + 1,
    evidenceRefs: item.evidenceRefs.filter((id) => knownIds.has(id)),
  }));
}

function dedupeEvidenceRefs(refs: ReadonlyArray<EvidenceRef>): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

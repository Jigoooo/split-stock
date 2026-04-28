import { z } from 'zod';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { AiCredentialsRepo } from './ai-credentials-repo';
import { type AlgoSignals, computeAlgoSignals } from './algo/algo-signals';
import {
  applyTierQuota,
  preRank,
  scoreToTier,
  summarizeTiers,
  type Tier,
  type TierDistribution,
} from './algo/composite-score';
import { buildCandidatePool, type CandidateEntry } from './build-candidate-pool';
import type { LlmClient, ToolDef } from './llm-client';
import type { MarketContextSnapshot } from './market-context-service';
import type { NewsItem } from './news-fetcher';
import { computeSymbolStats, type SymbolStat } from './symbol-stats';

export interface SuggestSymbolsInput {
  db: Db;
  accountId: number;
  candlesRepo: DailyCandlesRepo;
  aiCredentialsRepo: AiCredentialsRepo;
  llmClient: LlmClient;
  logger: EventLogger;
  /** 후보 풀 cap. 기본 30. */
  poolCap?: number;
  /** 응답 Top N (recommended 분배). 기본 8 (top 2 + strong 3 + moderate 2 + watch 1 + avoid 1 - quota cap). */
  topN?: number;
  /** 사용자가 stock-picker 등으로 추가한 pdno 목록 — 보유/감시에 없어도 풀에 합쳐 추천. */
  extraPdnos?: ReadonlyArray<string>;
  /**
   * D 풀(자동 발굴) 포함 여부. 기본 true — A∪B∪C∪D 합집합. UI 토글로 끌 수 있음.
   */
  includeAutoDiscovery?: boolean;
  /**
   * 후보 pdno 목록의 일봉 캐시를 사전 보충. 호출자(ai-router)가 KIS env/auth 컨텍스트를
   * 들고 ensure 콜백을 주입. 미주입 시 캐시만 사용 (기존 동작).
   */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
  /**
   * 종목별 최신 뉴스 fetch 콜백 — 라우터가 NewsFetcher 컨텍스트로 wrap. 미주입 시 뉴스 무.
   * 여러 종목을 받아 pdno→newsItems Map 으로 반환. AI on 일 때만 호출 권장.
   */
  fetchNews?: (
    candidates: ReadonlyArray<{ pdno: string; name: string }>,
  ) => Promise<Map<string, ReadonlyArray<NewsItem>>>;
  /**
   * Tool: search_news 콜백 — LLM 이 필요 시 추가 키워드로 뉴스 검색.
   * (query, max?) → NewsItem[]. fetchNews 와 별도 — 사전 fetch 가 아닌 LLM 의 능동 호출.
   */
  searchNewsTool?: (query: string, max: number) => Promise<ReadonlyArray<NewsItem>>;
  /**
   * Tool: DART 공시 콜백. corpCode + days → 공시 텍스트 요약.
   */
  getDartDisclosuresTool?: (
    corpCode: string,
    days: number,
  ) => Promise<ReadonlyArray<{ date: string; title: string; report: string }>>;
  /**
   * KRX/ECOS 캐시 기반 시장 컨텍스트. LLM/UI 는 여기서 확인된 캐시 데이터만 사용하고,
   * 추천 점수나 consensusCount 의 직접 입력으로 쓰지 않는다.
   */
  getMarketContextForPdnos?: (pdnos: ReadonlyArray<string>) => Promise<MarketContextSnapshot>;
  /**
   * AI 끄기 모드 — true 면 LLM 호출 0회, 알고리즘 신호만으로 ranking. 결과 카드의
   * pros/cons/entryNote 는 알고리즘 라벨에서 합성.
   */
  aiOff?: boolean;
}

const TierSchema = z.enum(['top', 'strong', 'moderate', 'watch', 'avoid']);
const ConfidenceSchema = z.enum(['high', 'med', 'low']);

function compactText(value: string, max: number): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function compactTextList(values: ReadonlyArray<string>, max: number): string[] {
  return values.map((value) => compactText(value, max)).filter((value) => value.length > 0);
}

const RankedItemSchema = z.object({
  pdno: z.string(),
  score: z.number().min(0).max(100),
  tier: TierSchema,
  confidence: ConfidenceSchema,
  volatilityFit: z.enum(['low', 'mid', 'high']),
  liquidityFit: z.enum(['good', 'ok', 'poor']),
  /** 한 줄 평 — 카드 기본 노출. */
  summary: z.string().min(1),
  /** 매직스플릿 적용 시 강점. 0~3개. */
  pros: z.array(z.string()).max(3).default([]),
  /** 주의점/리스크. 0~3개. */
  cons: z.array(z.string()).max(3).default([]),
  /** 진입 시 참고할 한 줄 (예: "박스권 하단 근처 1차 매수 추천"). 없으면 null. */
  entryNote: z.string().nullable().default(null),
  /** 몇 개 지표가 동의했는지 (LLM 판단). */
  consensusCount: z.number().int().min(0).max(10).default(0),
  /** 호출한 도구 이름 — 빈 배열이면 추가 검증 미수행 표시. */
  citedTools: z.array(z.string()).default([]),
});

const SuggestionResponseSchema = z.object({
  recommended: z.array(RankedItemSchema),
  userInputResults: z.array(RankedItemSchema).default([]),
});

export interface RankedSymbolStats {
  lastClose: number | null;
  volatility60d: number | null;
  avgVolume60d: number | null;
  rangePct120d: number | null;
}

export interface RankedMarketContext {
  krx: {
    date: string;
    close: number | null;
    changeRate: number | null;
    volume: number | null;
    tradeValue: number | null;
    marketCap: number | null;
  } | null;
  ecos: ReadonlyArray<{
    indicator: string;
    date: string;
    value: number;
    unitName: string | null;
  }>;
  status: {
    krx: { isAvailable: boolean; isStale: boolean; lastError: string | null };
    ecos: { isAvailable: boolean; isStale: boolean; lastError: string | null };
  };
}

export type RankedSymbol = z.infer<typeof RankedItemSchema> & {
  /** 응답에 lookup 한 종목명. */
  name: string;
  /** 후보 출처 (보유/감시/수동/자동발굴). */
  sources: ReadonlyArray<'OWNED' | 'WATCH' | 'MANUAL' | 'AUTO'>;
  /** 통계 수치 — UI 에서 LLM 점수 근거를 직접 노출. */
  stats: RankedSymbolStats;
  /** KRX/ECOS 캐시 컨텍스트 — 보조 사실/리스크 플래그 전용. */
  marketContext: RankedMarketContext | null;
  /** 결정론적 알고리즘 점수 (0~100). LLM 점수와 비교해 일관성 검증 가능. */
  algoScore: number | null;
  /** 알고리즘 라벨 (변동성/박스권/RSI/거래량 spike 등). */
  algoLabels: ReadonlyArray<string>;
  /** AI 끄기 모드로 생성된 결과인지. */
  aiOff: boolean;
  /** LLM 이 참조한(또는 AI off 시 미사용) 뉴스 원본. UI 카드 펼침 시 노출. */
  news: ReadonlyArray<NewsItem>;
  /** 알고리즘이 제시한 모순 신호 — 빈 배열이면 충돌 없음. */
  conflicts: ReadonlyArray<string>;
  /** 지표별 사실 기반 사유 (UI 카드 펼침 노출). */
  indicatorReasons: ReadonlyArray<{ indicator: string; value: string; meaning: string }>;
};

export interface SuggestSymbolsResult {
  /** 자동 추천 — Top 8 분배 (top/strong/moderate/watch/avoid). */
  ranked: RankedSymbol[];
  /** 사용자가 직접 추가(extras)한 종목의 별도 평가 결과. */
  userInputResults: RankedSymbol[];
  /** Tier 분포 요약 (UI 헤더). */
  distribution: TierDistribution;
  /** 분석에 들어간 후보 풀 크기 (A∪B∪C∪D 의 dedupe 후 cap 적용 결과). */
  poolSize: number;
  /** 후보 풀 자체가 비었거나 default 키 미설정 시 사유. */
  emptyReason: string | null;
  /** LLM 응답 중 풀 외 pdno 가 있어 silently 제거된 개수. */
  rejectedCount: number;
  /** LLM 호출 시간 (ms). */
  durationMs: number;
}

/**
 * AI 매직스플릿 적합 종목 추천 — 2-stage 흐름.
 *
 * Stage 1 (결정론, LLM 미호출):
 *   1) buildCandidatePool → A∪B∪C∪D, cap 30 (D = screenMagicSplitFit)
 *   2) ensureCandles → 일봉 보충
 *   3) computeAlgoSignals (indicatorts: BB/MACD/Aroon/MFI/PSAR + S/R + conflicts)
 *   4) preRank → Top 10 (composite score)
 *   5) AI off 모드면 Top 5 즉시 반환 — 토큰 0.
 *
 * Stage 2 (LLM 합성·검증, 압축된 입력):
 *   6) Top 10 만 LLM 입력 (30→10 토큰 ~64% 절감)
 *   7) tools 노출: search_news, get_dart_disclosures
 *   8) system prompt 강화: 합의 3+ / conflicts 인용 / 도구 호출 우선
 *   9) 응답: recommended (Top 8 분배) + userInputResults
 *
 * Stage 3 (검증):
 *   10) pdno 화이트리스트, algoScore vs LLM score 차이 30+ 시 cons prepend
 */
export async function suggestSymbols(input: SuggestSymbolsInput): Promise<SuggestSymbolsResult> {
  const startedAt = Date.now();
  const aiOff = input.aiOff === true;
  const includeAutoDiscovery = input.includeAutoDiscovery ?? true;
  const config = aiOff ? null : input.aiCredentialsRepo.getDefaultWithKey();
  if (!aiOff && !config) {
    return emptyResult(
      'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 키를 등록하거나 "AI 끄기" 모드를 선택하세요.',
      startedAt,
    );
  }

  const pool = buildCandidatePool({
    db: input.db,
    accountId: input.accountId,
    cap: input.poolCap ?? 30,
    candlesRepo: input.candlesRepo,
    includeAutoDiscovery,
    ...(input.extraPdnos && input.extraPdnos.length > 0 ? { extraPdnos: input.extraPdnos } : {}),
  });
  if (pool.length === 0) {
    return emptyResult(
      '후보 풀이 비었습니다. 보유/감시 종목, 또는 일봉 캐시된 종목이 있어야 추천이 가능합니다.',
      startedAt,
    );
  }

  if (input.ensureCandles) {
    await input.ensureCandles(pool.map((p) => p.pdno));
  }

  // === Stage 1 — 결정론 알고리즘 신호 ===
  const algoSignals = computeAlgoSignals({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
  });
  const algoByPdno = new Map(algoSignals.map((s) => [s.pdno, s]));

  const stats = computeSymbolStats({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
    precomputedSignals: algoByPdno,
  });
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));

  // === Pre-rank — LLM 입력 압축 (30→Top 10) ===
  const { top: topCandidates } = preRank({
    candidates: pool,
    signalsByPdno: algoByPdno,
    topN: 10,
  });

  // 사용자가 extras 로 직접 넣은 종목 — Top 10 외에라도 LLM 검증 받게 분리.
  const extraSet = new Set(input.extraPdnos ?? []);
  const extraCandidates = pool.filter((c) => extraSet.has(c.pdno));
  const contextTargets = [...topCandidates, ...extraCandidates];
  const marketContext = input.getMarketContextForPdnos
    ? await input.getMarketContextForPdnos(contextTargets.map((c) => c.pdno))
    : null;

  // AI 끄기 — 알고리즘만으로 결과 합성.
  if (aiOff) {
    const ranked = buildAlgoOnlyRanked(
      topCandidates,
      algoByPdno,
      statsByPdno,
      input.topN ?? 8,
      marketContext,
    );
    const userInputResults = buildAlgoOnlyRanked(
      extraCandidates,
      algoByPdno,
      statsByPdno,
      extraCandidates.length,
      marketContext,
    );
    input.logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'ai.suggest-symbols.algo-only',
      payload: {
        poolSize: pool.length,
        topN: ranked.length,
        userExtras: userInputResults.length,
        durationMs: Date.now() - startedAt,
      },
    });
    return {
      ranked,
      userInputResults,
      distribution: summarizeTiers(ranked),
      poolSize: pool.length,
      emptyReason: ranked.length === 0 ? '추천 가능한 종목이 없습니다.' : null,
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // === Stage 2 — LLM 합성 ===
  // 알고리즘 상위 + extras 만 뉴스 fetch (토큰/호출 절감).
  const newsTargets = [...topCandidates, ...extraCandidates];
  const newsByPdno = input.fetchNews ? await input.fetchNews(newsTargets) : new Map();

  const userPrompt = buildPrompt({
    topCandidates,
    extras: extraCandidates,
    stats,
    algoByPdno,
    newsByPdno,
    marketContext,
    topN: input.topN ?? 8,
  });

  if (!config) {
    return emptyResult('AI 키가 등록되지 않았습니다.', startedAt);
  }

  // === Tools — LLM 이 필요 시 호출 ===
  const tools = buildTools(input, marketContext);

  const result = await input.llmClient.chat({
    config,
    schema: SuggestionResponseSchema,
    schemaName: 'AiSymbolSuggestion',
    maxOutputTokens: 3500,
    temperature: 0.2,
    ...(tools.length > 0 ? { tools, maxToolIterations: 3 } : {}),
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!result.parsed) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-symbols.parse-failed-fallback',
      payload: { rawChars: result.text.length, toolCalls: result.toolCalls.length },
    });
    // 디버그용 — 실제 응답 텍스트와 도구 호출 이력 출력.
    console.error(
      '[suggestSymbols] parse failed. rawText:',
      JSON.stringify(result.text.slice(0, 500)),
    );
    console.error('[suggestSymbols] toolCalls count:', result.toolCalls.length);
    if (result.toolCalls.length > 0) {
      console.error(
        '[suggestSymbols] toolCalls:',
        JSON.stringify(
          result.toolCalls.map((tc) => ({ name: tc.name, resultLen: String(tc.result).length })),
        ),
      );
    }
    const ranked = buildAlgoOnlyRanked(
      topCandidates,
      algoByPdno,
      statsByPdno,
      input.topN ?? 8,
      marketContext,
    );
    const userInputResults = buildAlgoOnlyRanked(
      extraCandidates,
      algoByPdno,
      statsByPdno,
      extraCandidates.length,
      marketContext,
    );
    return {
      ranked,
      userInputResults,
      distribution: summarizeTiers(ranked),
      poolSize: pool.length,
      emptyReason:
        ranked.length === 0 ? 'AI 응답 파싱에 실패했고 알고리즘 fallback 결과도 비었습니다.' : null,
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // === Stage 3 — 검증 + 합성 ===
  const allowedPdnos = new Set(pool.map((p) => p.pdno));
  const poolByPdno = new Map(pool.map((p) => [p.pdno, p]));
  let rejectedCount = 0;

  const buildRanked = (items: ReadonlyArray<z.infer<typeof RankedItemSchema>>): RankedSymbol[] => {
    const out: RankedSymbol[] = [];
    for (const item of items) {
      if (!allowedPdnos.has(item.pdno)) {
        rejectedCount++;
        continue;
      }
      const poolEntry = poolByPdno.get(item.pdno);
      const stat = statsByPdno.get(item.pdno);
      const algo = algoByPdno.get(item.pdno);
      const cons = compactTextList(enrichCons(item, algo), 200);
      const summary = compactText(item.summary, 200) || '분석 요약이 부족합니다.';
      const entryNote = item.entryNote ? compactText(item.entryNote, 300) || null : null;
      out.push({
        ...item,
        summary,
        pros: compactTextList(item.pros ?? [], 200).slice(0, 3),
        cons,
        entryNote,
        name: poolEntry?.name ?? item.pdno,
        sources: poolEntry?.sources ?? [],
        stats: {
          lastClose: stat?.lastClose ?? null,
          volatility60d: stat?.volatility60d ?? null,
          avgVolume60d: stat?.avgVolume60d ?? null,
          rangePct120d: stat?.rangePct120d ?? null,
        },
        marketContext: buildRankedMarketContext(item.pdno, marketContext),
        algoScore: algo?.splitScore ?? null,
        algoLabels: algo?.labels ?? [],
        aiOff: false,
        news: newsByPdno.get(item.pdno) ?? [],
        conflicts: algo?.conflicts ?? [],
        indicatorReasons: algo?.indicatorReasons ?? [],
      });
    }
    return out;
  };

  const recommendedRaw = buildRanked(result.parsed.recommended);
  // tier quota 적용 — top≤2 strong≤3 moderate≤2 watch≤1 avoid≤1.
  const recommended = applyTierQuota(recommendedRaw).slice(0, input.topN ?? 8);
  const userInputResults = buildRanked(result.parsed.userInputResults);

  input.logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'ai.suggest-symbols.ok',
    payload: {
      poolSize: pool.length,
      provider: config.provider,
      model: config.model,
      topN: recommended.length,
      userInputN: userInputResults.length,
      rejectedCount,
      toolCalls: result.toolCalls.length,
      durationMs: Date.now() - startedAt,
    },
  });

  return {
    ranked: recommended,
    userInputResults,
    distribution: summarizeTiers(recommended),
    poolSize: pool.length,
    emptyReason: recommended.length === 0 ? '추천할 만한 종목이 없습니다.' : null,
    rejectedCount,
    durationMs: Date.now() - startedAt,
  };
}

const SYSTEM_PROMPT = [
  '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 보조 분석가입니다.',
  '',
  '핵심 원칙 (가장 중요):',
  '1. 후보 풀에 명시된 pdno 코드 안에서만 추천. 풀 외 종목은 절대 포함 X.',
  '2. 정보 신뢰성 우선. 추측/일반론 X. 알고리즘 신호(splitScore, RSI, BB, MFI, Aroon, conflicts, indicatorReasons)와 뉴스 제목/요약/날짜를 직접 인용해 근거 작성.',
  '3. consensus 규칙: BB/RSI/MFI/momentum/Stochastic/CCI 중 3개 이상이 동일 방향(과매수 또는 과매도)일 때만 strong 신호로 판단. 1~2개 동의 = weak. consensusCount 필드에 동의 개수 명시.',
  '4. conflicts 가 비어있지 않으면 cons 에 반드시 인용. 무시 X.',
  '5. 데이터 부족(통계 부족 / 뉴스 0건)이면 confidence=low 로 표기 + cons 에 "데이터 부족" 명시.',
  '6. 도구 사용 우선: 알고리즘 신호가 모호하거나 confidence=low 면 search_news / get_dart_disclosures / get_market_context 를 호출해 보강. 호출한 도구는 citedTools 에 기록. 빈 배열이면 "추가 검증 미수행" 으로 간주.',
  '7. tier 매핑: score ≥85 top, 70-84 strong, 55-69 moderate, 40-54 watch, <40 avoid. 종목별로 tier 를 명시.',
  '8. 응답 분배:',
  '   - recommended: top/strong/moderate/watch/avoid 골고루 — 사용자에게 다양한 정보 제공.',
  '   - userInputResults: 사용자가 입력한 종목(extras) 의 평가. recommended 와 별도. tier 분배 X.',
  '9. summary 는 사실 기반 한 줄. pros/cons 는 행동 가이드. entryNote 는 진입 시점/주의사항 1줄.',
  '10. 알고리즘 점수(algoScore) 와 LLM 점수(score) 차이가 30점 이상이면 그 이유를 cons 에 짧게 적기.',
  '11. KRX/ECOS 컨텍스트는 캐시된 외부 사실입니다. modifier/risk flag/근거 사실로만 사용하고 consensusCount 계산에는 포함하지 마세요.',
  '',
  '매직스플릿 차수 구조 (중요):',
  '- 2차 이후 매수 트리거는 1차 가격 기준이 아니라 직전 차수 매수가 기준이다.',
  '  예) 1차 10,000원 매수 → 2차 트리거: 1차가 × (1-3%) = 9,700원 / 3차 트리거: 2차가 × (1-3%) = 9,409원.',
  '  "1차 기준으로 -9% 하락 시 3차"가 아니라 "직전 차수에서 매번 -3% 추가 하락" 구조.',
  '- entryNote 에서 차수 트리거를 언급할 때는 반드시 직전 차수 기준 하락률로 표현할 것.',
].join('\n');

function buildPrompt(args: {
  topCandidates: ReadonlyArray<CandidateEntry>;
  extras: ReadonlyArray<CandidateEntry>;
  stats: ReadonlyArray<SymbolStat>;
  algoByPdno: Map<string, AlgoSignals>;
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>;
  marketContext: MarketContextSnapshot | null;
  topN: number;
}): string {
  const { topCandidates, extras, stats, algoByPdno, newsByPdno, marketContext, topN } = args;
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));
  const lines: string[] = [];
  lines.push(
    `[recommended 풀 — ${topCandidates.length}개 사전 선별] 매직스플릿 적합도 상위 ${topN}개를`,
  );
  lines.push('top/strong/moderate/watch/avoid tier 로 골고루 분류해 주세요.');
  lines.push('');
  if (extras.length > 0) {
    lines.push(
      `[user input — ${extras.length}개] 사용자가 직접 추가한 종목. recommended 와 별도로 평가.`,
    );
    lines.push('');
  }
  lines.push('매직스플릿 적합도 판단 기준:');
  lines.push('- 변동성 적정 (너무 낮으면 차수 트리거 부족, 너무 높으면 손실 위험)');
  lines.push('- 거래량 충분 (슬리피지 방지)');
  lines.push('- 박스권 폭 적정 (차수 간격 설계 가능)');
  lines.push('- BB position / RSI / MFI 등이 oversold consensus 일 때 1차 진입 매력 ↑');
  lines.push('- Aroon strong-trend 면 매직스플릿 부적합 — 추세장 회피');
  lines.push('');
  lines.push('응답 JSON schema:');
  lines.push(
    '{"recommended":[{"pdno":"<풀의 pdno>","score":0~100,"tier":"top|strong|moderate|watch|avoid","confidence":"high|med|low","volatilityFit":"low|mid|high","liquidityFit":"good|ok|poor","summary":"한 줄(200자)","pros":[max 3, 각 200자],"cons":[max 3, 각 200자],"entryNote":"한 줄(300자) or null","consensusCount":0~10,"citedTools":["search_news","get_dart_disclosures",...]}],"userInputResults":[...동일 schema...]}',
  );
  lines.push('');
  lines.push('=== recommended 풀 ===');
  for (const c of topCandidates) {
    appendCandidateBlock(c, statsByPdno, algoByPdno, newsByPdno, marketContext, lines);
  }
  if (extras.length > 0) {
    lines.push('');
    lines.push('=== user input ===');
    for (const c of extras) {
      appendCandidateBlock(c, statsByPdno, algoByPdno, newsByPdno, marketContext, lines);
    }
  }
  lines.push('');
  lines.push('주의:');
  lines.push('- 후보 풀에 없는 pdno 는 응답에 포함하지 마세요.');
  lines.push('- conflicts 가 있으면 반드시 cons 에 그대로 인용.');
  lines.push('- consensusCount 는 BB/RSI/MFI/momentum/Stoch/CCI 중 동의한 개수.');
  lines.push('- citedTools 는 호출한 도구 이름. 호출 안 했으면 빈 배열.');
  lines.push('- KRX/ECOS 값은 캐시 보조 사실이며 consensusCount 에 포함하지 마세요.');
  return lines.join('\n');
}

function appendCandidateBlock(
  c: CandidateEntry,
  statsByPdno: Map<string, SymbolStat>,
  algoByPdno: Map<string, AlgoSignals>,
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>,
  marketContext: MarketContextSnapshot | null,
  lines: string[],
): void {
  const s = statsByPdno.get(c.pdno);
  const algo = algoByPdno.get(c.pdno);
  const sourcesLabel = c.sources.join('+');
  const algoBits =
    algo && algo.splitScore !== null
      ? [
          `algoScore=${algo.splitScore}`,
          `confidence=${algo.confidence}`,
          algo.rsi14 !== null ? `RSI=${algo.rsi14}` : null,
          algo.bollinger?.position !== undefined && algo.bollinger?.position !== null
            ? `BB.pos=${(algo.bollinger.position * 100).toFixed(0)}%`
            : null,
          algo.mfi14 !== null ? `MFI=${algo.mfi14}` : null,
          algo.aroon25
            ? `Aroon=${Math.round(algo.aroon25.up)}/${Math.round(algo.aroon25.down)}`
            : null,
          algo.atr14 !== null ? `ATR=${algo.atr14}` : null,
          algo.consensusLevel !== 'none'
            ? `consensus=${algo.consensusLevel}/${algo.consensusDirection}(${algo.consensusCount})`
            : null,
          algo.divergence !== 'none' ? `OBV.div=${algo.divergence}` : null,
        ]
          .filter((x): x is string => x !== null)
          .join(', ')
      : '';
  const conflictsBits =
    algo && algo.conflicts.length > 0 ? `\n    conflicts: ${algo.conflicts.join(' | ')}` : '';
  if (!s || s.dataReason) {
    lines.push(
      `- ${c.pdno} (${c.name}) [${sourcesLabel}] — 통계 부족(${s?.dataReason ?? 'no-data'}) ${algoBits}${conflictsBits}`,
    );
  } else {
    lines.push(
      `- ${c.pdno} (${c.name}) [${sourcesLabel}] — close=${s.lastClose}, vol60d=${s.volatility60d ?? 'n/a'}%, range120d=${s.rangePct120d ?? 'n/a'}% | ${algoBits}${conflictsBits}`,
    );
  }
  if (algo && algo.indicatorReasons.length > 0) {
    lines.push(
      `    reasons: ${algo.indicatorReasons.map((r) => `[${r.indicator}] ${r.value}`).join(' / ')}`,
    );
  }
  const marketBits = formatMarketContextForPrompt(c.pdno, marketContext);
  if (marketBits) {
    lines.push(`    시장 컨텍스트(캐시): ${marketBits}`);
  }
  const news = newsByPdno.get(c.pdno);
  if (news && news.length > 0) {
    lines.push(`    뉴스 ${news.length}건:`);
    news.forEach((n, idx) => {
      const summary = n.summary.length > 200 ? `${n.summary.slice(0, 200)}...` : n.summary;
      lines.push(`    [${idx + 1}] ${n.publishedAt} | ${n.title}`);
      if (summary) lines.push(`        ${summary}`);
    });
  }
}

function buildRankedMarketContext(
  pdno: string,
  snapshot: MarketContextSnapshot | null,
): RankedMarketContext | null {
  if (!snapshot) return null;
  const krx = snapshot.krxByPdno.get(pdno);
  const ecos = snapshot.ecos.map((p) => ({
    indicator: p.indicator,
    date: p.date,
    value: p.value,
    unitName: p.unitName,
  }));
  if (!krx && ecos.length === 0) return null;
  return {
    krx: krx
      ? {
          date: krx.date,
          close: krx.close,
          changeRate: krx.changeRate,
          volume: krx.volume,
          tradeValue: krx.tradeValue,
          marketCap: krx.marketCap,
        }
      : null,
    ecos,
    status: {
      krx: {
        isAvailable: snapshot.status.krx.isAvailable,
        isStale: snapshot.status.krx.isStale,
        lastError: snapshot.status.krx.lastError,
      },
      ecos: {
        isAvailable: snapshot.status.ecos.isAvailable,
        isStale: snapshot.status.ecos.isStale,
        lastError: snapshot.status.ecos.lastError,
      },
    },
  };
}

function formatMarketContextForPrompt(
  pdno: string,
  snapshot: MarketContextSnapshot | null,
): string | null {
  const context = buildRankedMarketContext(pdno, snapshot);
  if (!context) return null;
  const parts: string[] = [];
  if (context.krx) {
    parts.push(
      [
        `KRX date=${context.krx.date}`,
        context.krx.close !== null ? `close=${context.krx.close}` : null,
        context.krx.changeRate !== null ? `changeRate=${context.krx.changeRate}%` : null,
        context.krx.marketCap !== null ? `marketCap=${context.krx.marketCap}` : null,
        context.krx.volume !== null ? `volume=${context.krx.volume}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(', '),
    );
  }
  if (context.ecos.length > 0) {
    parts.push(
      `ECOS ${context.ecos
        .map((p) => `${p.indicator}=${p.value}${p.unitName ? p.unitName : ''}@${p.date}`)
        .join(', ')}`,
    );
  }
  const staleFlags = [
    context.status.krx.isStale ? 'KRX stale' : null,
    context.status.ecos.isStale ? 'ECOS stale' : null,
    context.status.krx.lastError ? `KRX error=${context.status.krx.lastError}` : null,
    context.status.ecos.lastError ? `ECOS error=${context.status.ecos.lastError}` : null,
  ].filter((v): v is string => v !== null);
  if (staleFlags.length > 0) parts.push(`status: ${staleFlags.join(' / ')}`);
  return parts.join(' | ');
}

function buildTools(
  input: SuggestSymbolsInput,
  marketContext: MarketContextSnapshot | null,
): ToolDef[] {
  const tools: ToolDef[] = [];
  if (input.searchNewsTool) {
    const searchNews = input.searchNewsTool;
    const searchNewsParams = z.object({
      query: z.string().min(1).max(60).describe('검색 키워드 — 보통 종목명'),
      max: z.number().int().min(1).max(8).default(5),
    });
    const searchNewsTool: ToolDef<z.infer<typeof searchNewsParams>> = {
      name: 'search_news',
      description:
        '특정 키워드(종목명, 이슈, 산업 키워드)로 한국 최신 뉴스 검색. 알고리즘 신호가 모호하거나 confidence=low 일 때 호출해 정보 보강.',
      parameters: searchNewsParams,
      run: async (args) => {
        const items = await searchNews(args.query, args.max);
        return JSON.stringify(
          items.map((i) => ({
            date: i.publishedAt,
            title: i.title,
            summary: i.summary.slice(0, 240),
          })),
        );
      },
    };
    tools.push(searchNewsTool as ToolDef);
  }
  if (input.getDartDisclosuresTool) {
    const getDart = input.getDartDisclosuresTool;
    const dartParams = z.object({
      corpCode: z.string().min(8).max(8).describe('DART corp_code (8자리)'),
      days: z.number().int().min(1).max(60).default(30),
    });
    const dartTool: ToolDef<z.infer<typeof dartParams>> = {
      name: 'get_dart_disclosures',
      description:
        'OpenDART 공시 검색 — corpCode + 최근 N일. 자사주매입/실적/유상증자 등 매수 결정에 직접 영향.',
      parameters: dartParams,
      run: async (args) => {
        const items = await getDart(args.corpCode, args.days);
        return JSON.stringify(items);
      },
    };
    tools.push(dartTool as ToolDef);
  }
  if (marketContext && (marketContext.krxByPdno.size > 0 || marketContext.ecos.length > 0)) {
    const marketParams = z.object({
      pdno: z
        .string()
        .regex(/^\d{6}$/)
        .describe('후보 풀의 6자리 종목코드'),
    });
    const marketTool: ToolDef<z.infer<typeof marketParams>> = {
      name: 'get_market_context',
      description:
        'KRX/ECOS 캐시 컨텍스트 조회. 추천 점수 직접 산출이 아닌 보조 사실·리스크 플래그 확인용.',
      parameters: marketParams,
      run: async (args) => {
        return JSON.stringify(buildRankedMarketContext(args.pdno, marketContext));
      },
    };
    tools.push(marketTool as ToolDef);
  }
  return tools;
}

/**
 * algoScore vs LLM score 30+ 차이 시 cons 에 자동 안내 prepend.
 * conflicts 가 LLM cons 에 없으면 강제 prepend.
 */
function enrichCons(
  item: z.infer<typeof RankedItemSchema>,
  algo: AlgoSignals | undefined,
): string[] {
  const cons = [...(item.cons ?? [])];
  if (algo) {
    if (algo.splitScore !== null && Math.abs(algo.splitScore - item.score) >= 30) {
      const note = `알고리즘 점수(${algo.splitScore}) vs LLM 점수(${item.score}) 차이 ≥30 — 추가 검증 권장`;
      cons.unshift(note);
    }
    // 정확 일치로만 dedupe — 부분 일치는 false positive 가 너무 많음.
    const seen = new Set(cons);
    for (const conflict of algo.conflicts) {
      if (!seen.has(conflict)) {
        cons.unshift(conflict);
        seen.add(conflict);
      }
    }
    if (item.citedTools.length === 0 && item.confidence !== 'high') {
      const tip = '추가 도구 검증 미수행 — 단일 알고리즘 판단';
      if (!seen.has(tip)) cons.unshift(tip);
    }
  }
  return cons.slice(0, 5);
}

function emptyResult(reason: string, startedAt: number): SuggestSymbolsResult {
  return {
    ranked: [],
    userInputResults: [],
    distribution: { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 },
    poolSize: 0,
    emptyReason: reason,
    rejectedCount: 0,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * AI 끄기 모드 — algoScore 내림차순 + tier 매핑으로 합성. LLM 호출 없음.
 */
function buildAlgoOnlyRanked(
  pool: ReadonlyArray<CandidateEntry>,
  algoByPdno: Map<string, AlgoSignals>,
  statsByPdno: Map<string, SymbolStat>,
  topN: number,
  marketContext: MarketContextSnapshot | null,
): RankedSymbol[] {
  const ranked = [...pool]
    .map((c) => {
      const algo = algoByPdno.get(c.pdno);
      const stat = statsByPdno.get(c.pdno);
      const score = algo?.splitScore ?? 0;
      const tier: Tier = scoreToTier(algo?.splitScore ?? null);
      const volComp = algo?.components.volatility ?? null;
      const liqComp = algo?.components.liquidity ?? null;
      const volatilityFit: 'low' | 'mid' | 'high' =
        volComp === null ? 'mid' : volComp >= 75 ? 'mid' : volComp >= 40 ? 'low' : 'high';
      const liquidityFit: 'good' | 'ok' | 'poor' =
        liqComp === null ? 'ok' : liqComp >= 75 ? 'good' : liqComp >= 50 ? 'ok' : 'poor';
      const labels = algo?.labels ?? [];
      const pros: string[] = [];
      const cons: string[] = [...(algo?.conflicts ?? [])];
      if ((algo?.components.volatility ?? 0) >= 75) pros.push('변동성 적정 — 차수 트리거 충분');
      if ((algo?.components.liquidity ?? 0) >= 75) pros.push('거래량 충분 — 슬리피지 위험 낮음');
      if ((algo?.components.range ?? 0) >= 75) pros.push('박스권 폭 적정');
      if (algo?.bollinger?.position !== null && (algo?.bollinger?.position ?? 1) <= 0.15) {
        pros.push('BB 하단 근접 — 1차 진입 매력');
      }
      if (algo?.rsi14 !== null && algo !== undefined) {
        if (algo.rsi14 !== null) {
          if (algo.rsi14 >= 70) cons.push(`RSI ${algo.rsi14} 과매수 — 진입 시점 지연 권장`);
          else if (algo.rsi14 <= 30) pros.push(`RSI ${algo.rsi14} 과매도 — 1차 진입 매력`);
        }
      }
      if (algo?.volumeSpikeRatio && algo.volumeSpikeRatio >= 1.5) {
        cons.push(`거래량 ${algo.volumeSpikeRatio}x spike — 이벤트 임박 가능성`);
      }
      const entryNote =
        algo?.box && algo.rsi14 !== null
          ? `박스권 ${algo.box.low.toLocaleString()}~${algo.box.high.toLocaleString()} 중 RSI ${algo.rsi14}. 박스 하단 1차 매수 검토.`
          : null;
      return {
        pdno: c.pdno,
        name: c.name,
        score,
        tier,
        confidence: algo?.confidence ?? 'low',
        volatilityFit,
        liquidityFit,
        summary:
          labels.length > 0
            ? labels.join(' / ')
            : algo?.splitScore !== null
              ? `알고리즘 점수 ${algo?.splitScore ?? 0}점`
              : '데이터 부족',
        pros: pros.slice(0, 3),
        cons: cons.slice(0, 3),
        entryNote,
        consensusCount: algo?.consensusCount ?? 0,
        citedTools: [],
        sources: c.sources,
        stats: {
          lastClose: stat?.lastClose ?? null,
          volatility60d: stat?.volatility60d ?? null,
          avgVolume60d: stat?.avgVolume60d ?? null,
          rangePct120d: stat?.rangePct120d ?? null,
        },
        marketContext: buildRankedMarketContext(c.pdno, marketContext),
        algoScore: algo?.splitScore ?? null,
        algoLabels: labels,
        aiOff: true,
        news: [],
        conflicts: algo?.conflicts ?? [],
        indicatorReasons: algo?.indicatorReasons ?? [],
      } satisfies RankedSymbol;
    })
    .sort((a, b) => b.score - a.score);
  return applyTierQuota(ranked).slice(0, topN);
}

import { applyTierQuota, preRank, summarizeTiers } from '../algo/composite-score';
import { type AutoDiscoveredCandidate, disabledAutoDiscoveryDiagnostics } from '../auto-discovery';
import { buildRangeCycleFacts } from '../range-cycle-facts';
import { buildPool } from './candidate-flow';
import { extractDisclosureEvidenceRefs } from './evidence';
import {
  DEFAULT_MAX_SYMBOLS_PER_PASS,
  dedupeCandidates,
  fetchExternalContext,
} from './external-context';
import {
  buildRankedMarketContext,
  diagnosticsFromMarketContext,
  mergeDiagnostics,
  safeContextFetch,
} from './market-context';
import { buildPrompt, SYSTEM_PROMPT } from './prompt';
import {
  buildAlgoOnlyRanked,
  buildAlgoOnlyResult,
  buildLlmRankedSymbols,
  buildParseFallbackResult,
  emptyResult,
} from './ranked-results';
import { buildTools } from './tools';
import {
  SuggestionResponseSchema,
  type SuggestSymbolsDiagnostics,
  type SuggestSymbolsInput,
  type SuggestSymbolsResult,
} from './types';

const DEFAULT_RECOMMENDATION_TOP_N = 12;
const MAX_PRE_RANK_CANDIDATES = 30;
const AI_EXTERNAL_CONTEXT_TIMEOUT_MS = 15_000;
const AI_SYMBOL_LLM_TIMEOUT_MS = 45_000;

export async function runSuggestSymbols(input: SuggestSymbolsInput): Promise<SuggestSymbolsResult> {
  const startedAt = Date.now();
  const aiOff = input.aiOff === true;
  const includeAutoDiscovery = input.includeAutoDiscovery ?? true;
  const requestedTopN = input.topN ?? DEFAULT_RECOMMENDATION_TOP_N;
  let diagnostics: SuggestSymbolsDiagnostics = {
    discovery: disabledAutoDiscoveryDiagnostics(),
    sources: [],
  };
  const config = aiOff ? null : input.aiCredentialsRepo.getDefaultWithKey();
  if (!aiOff && !config) {
    return emptyResult(
      'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 키를 등록하거나 "AI 끄기" 모드를 선택하세요.',
      startedAt,
      diagnostics,
    );
  }

  const basePool = buildPool(input, false);
  let autoCandidates: AutoDiscoveredCandidate[] | undefined;
  if (includeAutoDiscovery && input.discoverAutoCandidates) {
    const discovered = await discoverCandidates(input, basePool, diagnostics);
    autoCandidates = discovered.autoCandidates;
    diagnostics = discovered.diagnostics;
  }

  const pool = buildPool(input, includeAutoDiscovery, autoCandidates);
  input.logger.log({
    level: 'INFO',
    category: 'AI',
    message: 'ai.suggest-symbols.pool-built',
    payload: {
      basePoolSize: basePool.length,
      autoCandidates: autoCandidates?.length ?? 0,
      poolSize: pool.length,
      includeAutoDiscovery,
      aiOff,
      requestedTopN,
      sample: pool.slice(0, 20).map((candidate) => ({
        pdno: candidate.pdno,
        name: candidate.name,
        sources: candidate.sources,
      })),
    },
  });
  if (pool.length === 0) {
    return emptyResult(
      includeAutoDiscovery
        ? '후보 풀이 비었습니다. 자동발굴도 후보를 찾지 못했습니다.'
        : '후보 풀이 비었습니다. 보유/감시 종목 또는 관심 종목을 추가하세요.',
      startedAt,
      diagnostics,
    );
  }
  if (input.ensureCandles) await input.ensureCandles(pool.map((p) => p.pdno));

  const marketContext = await fetchMarketContext(input, pool, diagnostics);
  diagnostics.sources = mergeDiagnostics(
    diagnostics.sources,
    marketContext ? diagnosticsFromMarketContext(marketContext) : [],
  );

  const facts = buildRangeCycleFacts({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
    marketContextByPdno: (pdno) => buildRankedMarketContext(pdno, marketContext),
  });
  const factsByPdno = new Map(facts.map((f) => [f.pdno, f]));
  const algoByPdno = new Map(facts.map((f) => [f.pdno, f.algo]));
  const stats = facts.map((f) => f.stat);
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));

  const preRankCount = clamp(requestedTopN * 2, 10, MAX_PRE_RANK_CANDIDATES);
  const { top: topCandidates } = preRank({
    candidates: pool,
    signalsByPdno: algoByPdno,
    topN: preRankCount,
  });
  const extraSet = new Set(input.extraPdnos ?? []);
  const extraCandidates = pool.filter((c) => extraSet.has(c.pdno));
  const promptTopCandidates = topCandidates.filter((c) => !extraSet.has(c.pdno));

  if (aiOff) {
    return buildAlgoOnlyResult({ ...input, topN: requestedTopN }, startedAt, diagnostics, {
      pool,
      topCandidates: promptTopCandidates,
      extraCandidates,
      algoByPdno,
      statsByPdno,
      marketContext,
      factsByPdno,
    });
  }

  const newsTargets = dedupeCandidates([...topCandidates, ...extraCandidates]).slice(
    0,
    DEFAULT_MAX_SYMBOLS_PER_PASS,
  );
  const externalContext =
    (await withTimeout(
      fetchExternalContext(input, newsTargets, diagnostics),
      AI_EXTERNAL_CONTEXT_TIMEOUT_MS,
    )) ?? emptyExternalContext(input, diagnostics);
  diagnostics = externalContext.diagnostics;

  const userPrompt = buildPrompt({
    topCandidates: promptTopCandidates,
    extras: extraCandidates,
    stats,
    algoByPdno,
    newsByPdno: externalContext.newsByPdno,
    newsEvidenceByPdno: externalContext.newsEvidenceByPdno,
    searchTrendsByPdno: externalContext.searchTrendsByPdno,
    marketContext,
    topN: requestedTopN,
  });
  if (!config) return emptyResult('AI 키가 등록되지 않았습니다.', startedAt, diagnostics);

  const tools = buildTools(input, marketContext);
  const result = await withTimeout(
    input.llmClient.chat({
      config,
      schema: SuggestionResponseSchema,
      schemaName: 'AiSymbolSuggestion',
      maxOutputTokens: 3500,
      temperature: 0.2,
      ...(tools.length > 0 ? { tools, maxToolIterations: 2 } : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
    AI_SYMBOL_LLM_TIMEOUT_MS,
  );
  if (result === null) {
    input.logger.log({
      level: 'WARN',
      category: 'AI',
      message: 'ai.suggest-symbols.timeout-fallback',
      payload: {
        timeoutMs: AI_SYMBOL_LLM_TIMEOUT_MS,
        poolSize: pool.length,
        topCandidates: promptTopCandidates.length,
      },
    });
    return buildParseFallbackResult(requestedTopN, startedAt, diagnostics, {
      pool,
      topCandidates: promptTopCandidates,
      extraCandidates,
      algoByPdno,
      statsByPdno,
      marketContext,
      factsByPdno,
    });
  }

  if (!result.parsed) {
    input.logger.log({
      level: 'WARN',
      category: 'AI',
      message: 'ai.suggest-symbols.parse-failed-fallback',
      payload: { rawChars: result.text.length, toolCalls: result.toolCalls.length },
    });
    return buildParseFallbackResult(requestedTopN, startedAt, diagnostics, {
      pool,
      topCandidates: promptTopCandidates,
      extraCandidates,
      algoByPdno,
      statsByPdno,
      marketContext,
      factsByPdno,
    });
  }

  let rejectedCount = 0;
  const rankedArgs = {
    allowedPdnos: new Set(pool.map((p) => p.pdno)),
    poolByPdno: new Map(pool.map((p) => [p.pdno, p])),
    statsByPdno,
    algoByPdno,
    factsByPdno,
    marketContext,
    newsByPdno: externalContext.newsByPdno,
    newsEvidenceByPdno: externalContext.newsEvidenceByPdno,
    disclosureEvidenceRefs: extractDisclosureEvidenceRefs(result.toolCalls),
    searchTrendsByPdno: externalContext.searchTrendsByPdno,
    onRejected: () => {
      rejectedCount++;
    },
  };
  const recommendedRaw = buildLlmRankedSymbols({
    ...rankedArgs,
    items: result.parsed.recommended,
  }).filter((item) => !extraSet.has(item.pdno));
  const fallbackRanked = buildAlgoOnlyRanked(
    promptTopCandidates,
    algoByPdno,
    statsByPdno,
    preRankCount,
    marketContext,
    factsByPdno,
    { applyQuota: false },
  );
  const diverseRecommendations = fillDiverseRecommendations(
    recommendedRaw.filter((item) => item.dataQuality !== 'blocked'),
    fallbackRanked.filter((item) => item.dataQuality !== 'blocked'),
    requestedTopN,
  );
  const recommended = fillAfterTierQuota(
    applyTierQuota(diverseRecommendations),
    diverseRecommendations,
    requestedTopN,
  );
  const userInputResults = buildLlmRankedSymbols({
    ...rankedArgs,
    items: result.parsed.userInputResults,
  });

  input.logger.log({
    level: 'INFO',
    category: 'AI',
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
    emptyReason:
      recommended.length === 0 && userInputResults.length === 0
        ? '추천할 만한 종목이 없습니다.'
        : null,
    rejectedCount,
    durationMs: Date.now() - startedAt,
    diagnostics,
  };
}

async function discoverCandidates(
  input: SuggestSymbolsInput,
  basePool: ReadonlyArray<{ pdno: string }>,
  current: SuggestSymbolsDiagnostics,
): Promise<{
  autoCandidates: AutoDiscoveredCandidate[] | undefined;
  diagnostics: SuggestSymbolsDiagnostics;
}> {
  try {
    const discovered = await input.discoverAutoCandidates?.(new Set(basePool.map((p) => p.pdno)));
    if (discovered) {
      input.logger.log({
        level: 'INFO',
        category: 'AI',
        message: 'ai.suggest-symbols.auto-discovery-result',
        payload: {
          candidates: discovered.candidates.length,
          sample: discovered.candidates.slice(0, 20),
          diagnostics: discovered.diagnostics,
        },
      });
    }
    return {
      autoCandidates: discovered?.candidates,
      diagnostics: discovered
        ? { discovery: discovered.diagnostics, sources: discovered.diagnostics.sources }
        : current,
    };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    input.logger.log({
      level: 'WARN',
      category: 'AI',
      message: 'ai.suggest-symbols.auto-discovery-failed',
      payload: { reason },
    });
    const failed = { source: 'krx' as const, status: 'failed' as const, reason };
    return {
      autoCandidates: undefined,
      diagnostics: {
        discovery: {
          ...disabledAutoDiscoveryDiagnostics(),
          enabled: true,
          emptyReason: 'auto_discovery_failed',
          sources: [failed],
        },
        sources: [failed],
      },
    };
  }
}

function fillDiverseRecommendations<T extends { pdno: string; marketContext?: unknown }>(
  primary: ReadonlyArray<T>,
  fallback: ReadonlyArray<T>,
  limit: number,
): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();
  const bucketCounts = new Map<string, number>();
  const softBucketLimit = Math.max(2, Math.ceil(limit / 4));
  const merged = [...primary, ...fallback];

  const push = (item: T, enforceBucketLimit: boolean): void => {
    if (selected.length >= limit || seen.has(item.pdno)) return;
    const bucket = recommendationBucketKey(item);
    const count = bucketCounts.get(bucket) ?? 0;
    if (enforceBucketLimit && count >= softBucketLimit) return;
    selected.push(item);
    seen.add(item.pdno);
    bucketCounts.set(bucket, count + 1);
  };

  for (const item of primary) push(item, true);
  for (const item of fallback) push(item, true);
  for (const item of merged) push(item, false);
  return selected;
}

function fillAfterTierQuota<T extends { pdno: string }>(
  quotaPreferred: ReadonlyArray<T>,
  candidates: ReadonlyArray<T>,
  limit: number,
): T[] {
  const out = [...quotaPreferred];
  const seen = new Set(out.map((item) => item.pdno));
  for (const item of candidates) {
    if (out.length >= limit) break;
    if (seen.has(item.pdno)) continue;
    out.push(item);
    seen.add(item.pdno);
  }
  return out.slice(0, limit);
}

function recommendationBucketKey(item: { marketContext?: unknown }): string {
  const krx = readKrxContext(item.marketContext);
  return [
    bucketNumber(krx?.marketCap ?? null, [11.2, 12.2, 13.2], 'cap'),
    bucketNumber(krx?.tradeValue ?? null, [9, 10, 11], 'trade'),
  ].join(':');
}

function readKrxContext(
  value: unknown,
): { marketCap: number | null; tradeValue: number | null } | null {
  if (typeof value !== 'object' || value === null || !('krx' in value)) return null;
  const krx = (value as { krx?: unknown }).krx;
  if (typeof krx !== 'object' || krx === null) return null;
  const data = krx as { marketCap?: unknown; tradeValue?: unknown };
  return {
    marketCap: typeof data.marketCap === 'number' ? data.marketCap : null,
    tradeValue: typeof data.tradeValue === 'number' ? data.tradeValue : null,
  };
}

function bucketNumber(value: number | null, thresholds: readonly number[], prefix: string): string {
  if (value === null || value <= 0) return `${prefix}-unknown`;
  const n = Math.log10(value);
  const index = thresholds.findIndex((threshold) => n < threshold);
  return `${prefix}-${index < 0 ? thresholds.length : index}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function emptyExternalContext(input: SuggestSymbolsInput, diagnostics: SuggestSymbolsDiagnostics) {
  input.logger.log({
    level: 'WARN',
    category: 'AI',
    message: 'ai.suggest-symbols.external-context-timeout',
    payload: { timeoutMs: AI_EXTERNAL_CONTEXT_TIMEOUT_MS },
  });
  return {
    diagnostics: {
      ...diagnostics,
      sources: mergeDiagnostics(diagnostics.sources, [
        { source: 'naver-news', status: 'failed' as const, reason: 'external-context-timeout' },
        { source: 'naver-datalab', status: 'failed' as const, reason: 'external-context-timeout' },
      ]),
    },
    newsByPdno: new Map(),
    newsEvidenceByPdno: new Map(),
    searchTrendsByPdno: new Map(),
  };
}

async function fetchMarketContext(
  input: SuggestSymbolsInput,
  pool: ReadonlyArray<{ pdno: string }>,
  diagnostics: SuggestSymbolsDiagnostics,
) {
  return input.getMarketContextForPdnos
    ? await safeContextFetch(
        () => input.getMarketContextForPdnos?.(pool.map((c) => c.pdno)) ?? Promise.resolve(null),
        input.logger,
        'market-context',
        (reason) => {
          diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
            { source: 'krx', status: 'failed', reason },
            { source: 'ecos', status: 'failed', reason },
          ]);
        },
      )
    : null;
}

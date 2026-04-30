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

export async function runSuggestSymbols(input: SuggestSymbolsInput): Promise<SuggestSymbolsResult> {
  const startedAt = Date.now();
  const aiOff = input.aiOff === true;
  const includeAutoDiscovery = input.includeAutoDiscovery ?? true;
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

  const { top: topCandidates } = preRank({ candidates: pool, signalsByPdno: algoByPdno, topN: 10 });
  const extraSet = new Set(input.extraPdnos ?? []);
  const extraCandidates = pool.filter((c) => extraSet.has(c.pdno));
  const promptTopCandidates = topCandidates.filter((c) => !extraSet.has(c.pdno));

  if (aiOff) {
    return buildAlgoOnlyResult(input, startedAt, diagnostics, {
      pool,
      topCandidates,
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
  const externalContext = await fetchExternalContext(input, newsTargets, diagnostics);
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
    topN: input.topN ?? 8,
  });
  if (!config) return emptyResult('AI 키가 등록되지 않았습니다.', startedAt, diagnostics);

  const tools = buildTools(input, marketContext);
  const result = await input.llmClient.chat({
    config,
    schema: SuggestionResponseSchema,
    schemaName: 'AiSymbolSuggestion',
    maxOutputTokens: 3500,
    temperature: 0.2,
    ...(tools.length > 0 ? { tools, maxToolIterations: 3 } : {}),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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
    return buildParseFallbackResult(input.topN ?? 8, startedAt, diagnostics, {
      pool,
      topCandidates,
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
  const recommendedRaw = buildLlmRankedSymbols({ ...rankedArgs, items: result.parsed.recommended });
  const recommended = applyTierQuota(
    recommendedRaw.filter((item) => item.dataQuality !== 'blocked'),
  ).slice(0, input.topN ?? 8);
  const userInputResults = buildLlmRankedSymbols({
    ...rankedArgs,
    items: result.parsed.userInputResults,
  });

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
      category: 'SYS',
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

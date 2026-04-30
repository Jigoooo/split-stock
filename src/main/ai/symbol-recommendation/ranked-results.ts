import type { AlgoSignals } from '../algo/algo-signals';
import { applyTierQuota, scoreToTier, summarizeTiers, type Tier } from '../algo/composite-score';
import type { CandidateEntry } from '../build-candidate-pool';
import type { MarketContextSnapshot } from '../market-context-service';
import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import type { NewsEvidencePack } from '../news-evidence';
import type { NewsItem } from '../news-fetcher';
import { capSymbolByDataQuality, type RangeCycleFacts } from '../range-cycle-facts';
import type { SymbolStat } from '../symbol-stats';
import { buildSymbolEvidenceRefs } from './evidence';
import { buildRankedMarketContext } from './market-context';
import type {
  RankedItem,
  RankedSymbol,
  SuggestSymbolsDiagnostics,
  SuggestSymbolsInput,
  SuggestSymbolsResult,
} from './types';

export function emptyResult(
  reason: string,
  startedAt: number,
  diagnostics: SuggestSymbolsDiagnostics,
): SuggestSymbolsResult {
  return {
    ranked: [],
    userInputResults: [],
    distribution: { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 },
    poolSize: 0,
    emptyReason: reason,
    rejectedCount: 0,
    durationMs: Date.now() - startedAt,
    diagnostics,
  };
}

export function buildAlgoOnlyResult(
  input: Pick<SuggestSymbolsInput, 'topN' | 'logger'>,
  startedAt: number,
  diagnostics: SuggestSymbolsDiagnostics,
  args: RankedFallbackArgs,
): SuggestSymbolsResult {
  const result = buildFallbackRanked(input.topN ?? 8, args);
  input.logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'ai.suggest-symbols.algo-only',
    payload: {
      poolSize: args.pool.length,
      topN: result.ranked.length,
      userExtras: result.userInputResults.length,
      durationMs: Date.now() - startedAt,
    },
  });
  return {
    ...result,
    poolSize: args.pool.length,
    emptyReason:
      result.ranked.length === 0 && result.userInputResults.length === 0
        ? '추천 가능한 종목이 없습니다.'
        : null,
    rejectedCount: 0,
    durationMs: Date.now() - startedAt,
    diagnostics,
  };
}

export function buildParseFallbackResult(
  topN: number,
  startedAt: number,
  diagnostics: SuggestSymbolsDiagnostics,
  args: RankedFallbackArgs,
): SuggestSymbolsResult {
  const result = buildFallbackRanked(topN, args);
  return {
    ...result,
    poolSize: args.pool.length,
    emptyReason:
      result.ranked.length === 0
        ? 'AI 응답 파싱에 실패했고 알고리즘 fallback 결과도 비었습니다.'
        : null,
    rejectedCount: 0,
    durationMs: Date.now() - startedAt,
    diagnostics,
  };
}

export interface RankedFallbackArgs {
  pool: ReadonlyArray<{ pdno: string }>;
  topCandidates: ReadonlyArray<CandidateEntry>;
  extraCandidates: ReadonlyArray<CandidateEntry>;
  algoByPdno: Map<string, AlgoSignals>;
  statsByPdno: Map<string, SymbolStat>;
  marketContext: MarketContextSnapshot | null;
  factsByPdno: Map<string, RangeCycleFacts>;
}

function buildFallbackRanked(topN: number, args: RankedFallbackArgs) {
  const ranked = buildAlgoOnlyRanked(
    args.topCandidates,
    args.algoByPdno,
    args.statsByPdno,
    topN,
    args.marketContext,
    args.factsByPdno,
  ).filter((item) => item.dataQuality !== 'blocked');
  const userInputResults = buildAlgoOnlyRanked(
    args.extraCandidates,
    args.algoByPdno,
    args.statsByPdno,
    args.extraCandidates.length,
    args.marketContext,
    args.factsByPdno,
  );
  return {
    ranked,
    userInputResults,
    distribution: summarizeTiers(ranked),
  };
}

export function buildAlgoOnlyRanked(
  pool: ReadonlyArray<CandidateEntry>,
  algoByPdno: Map<string, AlgoSignals>,
  statsByPdno: Map<string, SymbolStat>,
  topN: number,
  marketContext: MarketContextSnapshot | null,
  factsByPdno: Map<string, RangeCycleFacts>,
): RankedSymbol[] {
  const ranked = [...pool]
    .map((c) => buildAlgoRankedSymbol(c, algoByPdno, statsByPdno, marketContext, factsByPdno))
    .sort((a, b) => b.score - a.score);
  return applyTierQuota(ranked).slice(0, topN);
}

function buildAlgoRankedSymbol(
  c: CandidateEntry,
  algoByPdno: Map<string, AlgoSignals>,
  statsByPdno: Map<string, SymbolStat>,
  marketContext: MarketContextSnapshot | null,
  factsByPdno: Map<string, RangeCycleFacts>,
): RankedSymbol {
  const algo = algoByPdno.get(c.pdno);
  const stat = statsByPdno.get(c.pdno);
  const fact = factsByPdno.get(c.pdno);
  const capped = capSymbolByDataQuality(
    {
      score: algo?.rangeCycleScore ?? 0,
      tier: scoreToTier(algo?.rangeCycleScore ?? null),
      confidence: algo?.confidence ?? 'low',
      cons: [...(algo?.conflicts ?? [])],
    },
    fact?.dataQuality ?? 'blocked',
  );
  const volComp = algo?.components.volatility ?? null;
  const liqComp = algo?.components.liquidity ?? null;
  const labels = algo?.labels ?? [];
  const pros: string[] = [];
  const cons: string[] = [...capped.cons];
  if ((algo?.components.range ?? 0) >= 75) pros.push('박스권 폭 적정 — 차수 간격 설계 가능');
  if ((algo?.components.volatility ?? 0) >= 75)
    pros.push('변동성 적정 — 반복 매수/익절 트리거 충분');
  if ((algo?.components.liquidity ?? 0) >= 75) pros.push('거래량 충분 — 슬리피지 위험 낮음');
  if ((algo?.components.trendNeutrality ?? 0) >= 75) pros.push('추세 중립 — 박스권 회전 후보');
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
  return {
    pdno: c.pdno,
    name: c.name,
    score: capped.score,
    tier: capped.tier as Tier,
    confidence: capped.confidence as 'high' | 'med' | 'low',
    volatilityFit:
      volComp === null ? 'mid' : volComp >= 75 ? 'mid' : volComp >= 40 ? 'low' : 'high',
    liquidityFit: liqComp === null ? 'ok' : liqComp >= 75 ? 'good' : liqComp >= 50 ? 'ok' : 'poor',
    summary:
      labels.length > 0
        ? labels.join(' / ')
        : `박스권 분할매매 회전성 ${algo?.rangeCycleScore ?? 0}점`,
    pros: pros.slice(0, 3),
    cons: cons.slice(0, 3),
    entryNote:
      algo?.box && algo.rsi14 !== null
        ? `박스권 ${algo.box.low.toLocaleString()}~${algo.box.high.toLocaleString()} 중 RSI ${algo.rsi14}. 직전 차수 기준 하향 매수와 차수별 독립 익절 검토.`
        : null,
    consensusCount: algo?.consensusCount ?? 0,
    citedTools: [],
    sources: c.sources,
    stats: symbolStats(stat),
    marketContext: buildRankedMarketContext(c.pdno, marketContext),
    algoScore: algo?.rangeCycleScore ?? null,
    algoLabels: labels,
    aiOff: true,
    news: [],
    conflicts: algo?.conflicts ?? [],
    indicatorReasons: algo?.indicatorReasons ?? [],
    dataQuality: fact?.dataQuality ?? 'blocked',
    dataQualityReason: fact?.dataQualityReason ?? '데이터 없음',
    analysisConfidence: fact?.analysisConfidence ?? 'low',
    evidenceRefs: buildSymbolEvidenceRefs(fact, undefined),
    globalRisks: fact?.globalRisks ?? [],
    newsClusters: [],
  };
}

export function buildLlmRankedSymbols(args: {
  items: ReadonlyArray<RankedItem>;
  allowedPdnos: ReadonlySet<string>;
  poolByPdno: Map<string, CandidateEntry>;
  statsByPdno: Map<string, SymbolStat>;
  algoByPdno: Map<string, AlgoSignals>;
  factsByPdno: Map<string, RangeCycleFacts>;
  marketContext: MarketContextSnapshot | null;
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>;
  newsEvidenceByPdno: Map<string, NewsEvidencePack>;
  disclosureEvidenceRefs: ReadonlyArray<import('../range-cycle-facts').EvidenceRef>;
  searchTrendsByPdno: Map<string, NaverSearchTrendSummary>;
  onRejected: () => void;
}): RankedSymbol[] {
  const out: RankedSymbol[] = [];
  for (const item of args.items) {
    if (!args.allowedPdnos.has(item.pdno)) {
      args.onRejected();
      continue;
    }
    const poolEntry = args.poolByPdno.get(item.pdno);
    const algo = args.algoByPdno.get(item.pdno);
    const fact = args.factsByPdno.get(item.pdno);
    const anchored = anchorLlmScore(item, algo);
    const capped = capSymbolByDataQuality(anchored, fact?.dataQuality ?? 'blocked');
    out.push({
      ...capped,
      summary: compactText(anchored.summary, 200) || '분석 요약이 부족합니다.',
      pros: compactTextList(capped.pros ?? [], 200).slice(0, 3),
      cons: compactTextList(enrichCons(capped, algo), 200),
      entryNote: capped.entryNote ? compactText(capped.entryNote, 300) || null : null,
      name: poolEntry?.name ?? item.pdno,
      sources: poolEntry?.sources ?? [],
      stats: symbolStats(args.statsByPdno.get(item.pdno)),
      marketContext: buildRankedMarketContext(item.pdno, args.marketContext),
      algoScore: algo?.rangeCycleScore ?? null,
      algoLabels: algo?.labels ?? [],
      aiOff: false,
      news: args.newsByPdno.get(item.pdno) ?? [],
      conflicts: algo?.conflicts ?? [],
      indicatorReasons: algo?.indicatorReasons ?? [],
      dataQuality: fact?.dataQuality ?? 'blocked',
      dataQualityReason: fact?.dataQualityReason ?? '데이터 없음',
      analysisConfidence: fact?.analysisConfidence ?? 'low',
      evidenceRefs: buildSymbolEvidenceRefs(
        fact,
        args.newsEvidenceByPdno.get(item.pdno),
        item.citedTools,
        args.disclosureEvidenceRefs,
        args.searchTrendsByPdno.get(item.pdno),
      ),
      globalRisks: fact?.globalRisks ?? [],
      newsClusters: args.newsEvidenceByPdno.get(item.pdno)?.clusters ?? [],
    });
  }
  return out;
}

function anchorLlmScore(item: RankedItem, algo: AlgoSignals | undefined): RankedItem {
  const algoScore = algo?.rangeCycleScore ?? null;
  const maxScore = algoScore === null ? 40 : Math.min(100, algoScore + 10);
  if (item.score <= maxScore) return item;

  const score = Math.max(0, Math.min(100, Math.round(maxScore)));
  const reason =
    algoScore === null
      ? `AI 점수 상한 적용(${item.score}->${score}) — 알고리즘 신호 없음`
      : `AI 점수 상한 적용(${item.score}->${score}) — 회전성 점수 ${algoScore}`;
  const cons = [reason, ...(item.cons ?? [])].slice(0, 3);
  return {
    ...item,
    score,
    tier: scoreToTier(score),
    confidence: item.confidence === 'high' ? 'med' : item.confidence,
    cons,
  };
}

function enrichCons(item: RankedItem, algo: AlgoSignals | undefined): string[] {
  const cons = [...(item.cons ?? [])];
  if (!algo) return cons.slice(0, 5);
  if (algo.rangeCycleScore !== null && Math.abs(algo.rangeCycleScore - item.score) >= 30) {
    cons.unshift(
      `회전성 점수(${algo.rangeCycleScore}) vs LLM 점수(${item.score}) 차이 >=30 — 추가 검증 권장`,
    );
  }
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
  return cons.slice(0, 5);
}

function symbolStats(stat: SymbolStat | undefined) {
  return {
    lastClose: stat?.lastClose ?? null,
    volatility60d: stat?.volatility60d ?? null,
    avgVolume60d: stat?.avgVolume60d ?? null,
    rangePct120d: stat?.rangePct120d ?? null,
  };
}

function compactText(value: string, max: number): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function compactTextList(values: ReadonlyArray<string>, max: number): string[] {
  return values.map((value) => compactText(value, max)).filter((value) => value.length > 0);
}

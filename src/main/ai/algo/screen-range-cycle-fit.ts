import { eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { dailyCandles, stockMaster } from '../../db/schema';
import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';
import { ALGO_THRESHOLDS, computeAlgoSignals } from './algo-signals';
import { scoreToTier, type Tier } from './composite-score';

export interface ScreenRangeCycleFitInput {
  db: Db;
  candlesRepo: DailyCandlesRepo;
  /** 최대 후보 개수. 기본 50. */
  cap?: number;
  /** 일봉 최소 개수 — 기본 30. 데이터 부족만 hard block 하고 품질은 tier 로 표현한다. */
  minCandles?: number;
  /** 사전 제외할 pdno 목록 — A∪B∪C 와 중복 회피용. */
  excludePdnos?: ReadonlySet<string>;
  /** KRX 등 외부 universe 로 이미 1차 선별한 후보. 지정하면 이 목록만 스크리닝. */
  candidatePdnos?: ReadonlyArray<string>;
}

export type RangeCycleConditionKey =
  | 'score'
  | 'volatility'
  | 'range'
  | 'liquidity'
  | 'trendNeutrality';

export type RangeCycleConditionPasses = Record<RangeCycleConditionKey, boolean>;
export type RangeCycleConditionPassCounts = Record<RangeCycleConditionKey, number>;
export type RangeCycleTierCounts = Record<Tier, number>;

export interface ScreenedCandidate {
  pdno: string;
  name: string;
  rangeCycleScore: number | null;
  /** 자동발굴 ranking score. rangeCycleScore 에 진입 타이밍/리스크 보정을 더한 값. */
  score: number;
  tier: Tier;
  conditionPasses: RangeCycleConditionPasses;
  /** 조건 미달 사유 — 제외하지 않고 risk 로 노출한다. */
  riskReasons: ReadonlyArray<string>;
  /** 통과 사유 — 디버깅/UI 표시용. */
  reasons: ReadonlyArray<string>;
}

export interface ScreenRangeCycleDiagnostics {
  evaluatedCount: number;
  blockedCount: number;
  conditionPassCounts: RangeCycleConditionPassCounts;
  tierCounts: RangeCycleTierCounts;
  lowestIncludedScore: number | null;
}

export interface ScreenRangeCycleFitResult {
  candidates: ScreenedCandidate[];
  diagnostics: ScreenRangeCycleDiagnostics;
}

/**
 * 박스권 분할매매 자동발굴 ranking (D 풀).
 *
 * 대상: stock_master 종목 중 일봉 캐시 >= minCandles 봉 인 것만. 데이터/신호 산출 불가능만
 * hard block 하고, 점수/변동성/박스권/유동성/추세 조건 미달은 tier 와 riskReasons 로 남긴다.
 *
 * LLM 호출 0 — 전부 결정론 알고리즘. cap (기본 50) 으로 잘라 반환.
 */
export function screenRangeCycleFit(input: ScreenRangeCycleFitInput): ScreenedCandidate[] {
  return screenRangeCycleFitWithDiagnostics(input).candidates;
}

export function screenRangeCycleFitWithDiagnostics(
  input: ScreenRangeCycleFitInput,
): ScreenRangeCycleFitResult {
  const cap = Math.max(1, input.cap ?? 50);
  const minCandles = input.minCandles ?? ALGO_THRESHOLDS.minCandlesForBasic;
  const exclude = input.excludePdnos ?? new Set<string>();
  const diagnostics = emptyRangeCycleDiagnostics();

  // ≥minCandles 봉을 가진 pdno 목록 (D 봉만).
  const pdnoRows = input.db
    .select({
      pdno: dailyCandles.pdno,
      cnt: sql<number>`count(*)`,
    })
    .from(dailyCandles)
    .where(eq(dailyCandles.period, 'D'))
    .groupBy(dailyCandles.pdno)
    .having(({ cnt }) => gte(cnt, minCandles))
    .all();

  const countByPdno = new Map(pdnoRows.map((row) => [row.pdno, row.cnt]));
  const eligiblePdnos = input.candidatePdnos
    ? dedupePdnos(input.candidatePdnos).filter(
        (pdno) => !exclude.has(pdno) && countByPdno.has(pdno),
      )
    : pdnoRows.map((r) => r.pdno).filter((p) => !exclude.has(p));
  if (eligiblePdnos.length === 0) return { candidates: [], diagnostics };

  // 종목명 lookup — stock_master 매핑.
  const masters = input.db
    .select({ pdno: stockMaster.pdno, name: stockMaster.name })
    .from(stockMaster)
    .all();
  const nameByPdno = new Map(masters.map((m) => [m.pdno, m.name]));

  // 알고리즘 신호 계산 (cap × 4 까지만 — 너무 많이 계산하면 느림).
  const calcCap = Math.min(eligiblePdnos.length, cap * 4);
  const targetPdnos = eligiblePdnos.slice(0, calcCap);
  const signals = computeAlgoSignals({
    candlesRepo: input.candlesRepo,
    pdnos: targetPdnos,
  });

  const candidates: ScreenedCandidate[] = [];
  for (const sig of signals) {
    diagnostics.evaluatedCount++;
    if (sig.rangeCycleScore === null) {
      diagnostics.blockedCount++;
      continue;
    }
    const classified = classifyCandidate(sig);
    accumulateConditionCounts(diagnostics.conditionPassCounts, classified.conditionPasses);
    diagnostics.tierCounts[classified.tier]++;
    diagnostics.lowestIncludedScore =
      diagnostics.lowestIncludedScore === null
        ? classified.score
        : Math.min(diagnostics.lowestIncludedScore, classified.score);
    candidates.push({
      pdno: sig.pdno,
      name: nameByPdno.get(sig.pdno) ?? sig.pdno,
      rangeCycleScore: sig.rangeCycleScore,
      score: classified.score,
      tier: classified.tier,
      conditionPasses: classified.conditionPasses,
      riskReasons: classified.riskReasons,
      reasons: classified.reasons,
    });
  }

  // 보정 score 내림차순 정렬, cap 적용. cap 밖 후보는 UI 후보 풀 폭주 방지용으로만 잘린다.
  candidates.sort(
    (a, b) => b.score - a.score || (b.rangeCycleScore ?? 0) - (a.rangeCycleScore ?? 0),
  );
  const capped = candidates.slice(0, cap);
  diagnostics.tierCounts = countTiers(capped);
  diagnostics.lowestIncludedScore =
    capped.length === 0 ? null : Math.min(...capped.map((candidate) => candidate.score));
  return { candidates: capped, diagnostics };
}

function dedupePdnos(pdnos: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of pdnos) {
    const pdno = raw.padStart(6, '0');
    if (!/^\d{6}$/.test(pdno) || seen.has(pdno)) continue;
    seen.add(pdno);
    out.push(pdno);
  }
  return out;
}

export function emptyRangeCycleDiagnostics(): ScreenRangeCycleDiagnostics {
  return {
    evaluatedCount: 0,
    blockedCount: 0,
    conditionPassCounts: emptyConditionPassCounts(),
    tierCounts: emptyTierCounts(),
    lowestIncludedScore: null,
  };
}

function emptyConditionPassCounts(): RangeCycleConditionPassCounts {
  return {
    score: 0,
    volatility: 0,
    range: 0,
    liquidity: 0,
    trendNeutrality: 0,
  };
}

function emptyTierCounts(): RangeCycleTierCounts {
  return { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 };
}

function accumulateConditionCounts(
  counts: RangeCycleConditionPassCounts,
  passes: RangeCycleConditionPasses,
): void {
  for (const key of Object.keys(counts) as RangeCycleConditionKey[]) {
    if (passes[key]) counts[key]++;
  }
}

function countTiers(candidates: ReadonlyArray<ScreenedCandidate>): RangeCycleTierCounts {
  const counts = emptyTierCounts();
  for (const candidate of candidates) counts[candidate.tier]++;
  return counts;
}

function classifyCandidate(sig: {
  rangeCycleScore: number | null;
  components: {
    volatility: number | null;
    liquidity: number | null;
    range: number | null;
    bbPosition: number | null;
    supportProx: number | null;
    trendNeutrality: number | null;
    oversoldConsensus: number | null;
  };
  aroon25: {
    up: number;
    down: number;
    isStrongUpTrend: boolean;
    isStrongDownTrend: boolean;
  } | null;
  rsi14: number | null;
}): {
  score: number;
  tier: Tier;
  conditionPasses: RangeCycleConditionPasses;
  reasons: string[];
  riskReasons: string[];
} {
  const reasons: string[] = [];
  const riskReasons: string[] = [];

  const scorePass = sig.rangeCycleScore !== null && sig.rangeCycleScore >= 55;
  if (scorePass) reasons.push(`회전성 점수 ${sig.rangeCycleScore}`);
  else riskReasons.push(`회전성 점수 낮음(${formatScore(sig.rangeCycleScore)})`);

  const volPass = sig.components.volatility !== null && sig.components.volatility >= 60;
  if (volPass) reasons.push('변동성 적정');
  else riskReasons.push(`변동성 조건 미달(${formatScore(sig.components.volatility)})`);

  const rangePass = sig.components.range !== null && sig.components.range >= 65;
  if (rangePass) reasons.push('박스권 폭 적정');
  else riskReasons.push(`박스권 폭 조건 미달(${formatScore(sig.components.range)})`);

  const liqPass = sig.components.liquidity !== null && sig.components.liquidity >= 60;
  if (liqPass) reasons.push('거래량 충분');
  else riskReasons.push(`유동성 조건 미달(${formatScore(sig.components.liquidity)})`);

  const trendPass =
    !sig.aroon25?.isStrongUpTrend &&
    !sig.aroon25?.isStrongDownTrend &&
    (sig.components.trendNeutrality ?? 0) >= 45;
  if (trendPass) reasons.push('추세 중립');
  else riskReasons.push(`추세 중립 조건 미달(${formatScore(sig.components.trendNeutrality)})`);

  if (sig.components.supportProx !== null && sig.components.supportProx >= 80) {
    reasons.push('지지선 근접');
  }
  if (sig.components.bbPosition !== null && sig.components.bbPosition >= 80) {
    reasons.push('BB 하단권');
  }

  const score = adjustedDiscoveryScore(sig);
  return {
    score,
    tier: scoreToTier(score),
    conditionPasses: {
      score: scorePass,
      volatility: volPass,
      range: rangePass,
      liquidity: liqPass,
      trendNeutrality: trendPass,
    },
    reasons,
    riskReasons,
  };
}

function adjustedDiscoveryScore(sig: {
  rangeCycleScore: number | null;
  components: {
    volatility: number | null;
    liquidity: number | null;
    range: number | null;
    bbPosition: number | null;
    supportProx: number | null;
    trendNeutrality: number | null;
    oversoldConsensus: number | null;
  };
  aroon25: {
    isStrongUpTrend: boolean;
    isStrongDownTrend: boolean;
  } | null;
}): number {
  let score = sig.rangeCycleScore ?? 0;
  if ((sig.components.supportProx ?? 0) >= 80) score += 3;
  if ((sig.components.bbPosition ?? 0) >= 80) score += 2;
  if ((sig.components.oversoldConsensus ?? 0) >= 85) score += 2;

  if (sig.aroon25?.isStrongDownTrend) score -= 12;
  else if (sig.aroon25?.isStrongUpTrend) score -= 8;

  score += conditionPenalty(sig.components.liquidity, 60, 40, 4, 8);
  score += conditionPenalty(sig.components.volatility, 60, 40, 3, 6);
  score += conditionPenalty(sig.components.range, 65, 40, 3, 6);
  if ((sig.components.trendNeutrality ?? 0) < 45) score -= 4;

  return clampScore(score);
}

function conditionPenalty(
  value: number | null,
  passAt: number,
  weakAt: number,
  mildPenalty: number,
  severePenalty: number,
): number {
  if (value === null) return -severePenalty;
  if (value >= passAt) return 0;
  return value >= weakAt ? -mildPenalty : -severePenalty;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatScore(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

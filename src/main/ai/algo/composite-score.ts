import type { AlgoSignals } from './algo-signals';

export type Tier = 'top' | 'strong' | 'moderate' | 'watch' | 'avoid';

export interface PreRankInput<T extends { pdno: string }> {
  candidates: ReadonlyArray<T>;
  signalsByPdno: ReadonlyMap<string, AlgoSignals>;
  /** 압축 후 남길 개수. 기본 10. */
  topN?: number;
}

export interface PreRankResult<T> {
  /** Top N (composite score 내림차순). */
  top: ReadonlyArray<T>;
  /** 잘려나간 나머지. UI 에서 "검토만" 표기 가능. */
  remainder: ReadonlyArray<T>;
}

/**
 * 결정론적 사전 순위 — LLM 호출 전 후보 풀을 압축.
 *
 * rangeCycleScore 기준으로 정렬하되, rangeCycleScore 가 같거나 null 인 경우 components 합산을 fallback.
 * 데이터 부족(rangeCycleScore=null)은 우선순위 가장 낮음.
 */
export function preRank<T extends { pdno: string }>(input: PreRankInput<T>): PreRankResult<T> {
  const topN = Math.max(1, input.topN ?? 10);
  const sorted = [...input.candidates].sort((a, b) => {
    const sa = input.signalsByPdno.get(a.pdno);
    const sb = input.signalsByPdno.get(b.pdno);
    return effectiveScore(sb) - effectiveScore(sa);
  });
  return {
    top: sorted.slice(0, topN),
    remainder: sorted.slice(topN),
  };
}

function effectiveScore(s: AlgoSignals | undefined): number {
  if (!s) return -1;
  if (s.rangeCycleScore !== null) return s.rangeCycleScore;
  // rangeCycleScore null fallback — 컴포넌트 합산 평균.
  const parts = [
    s.components.volatility,
    s.components.liquidity,
    s.components.range,
    s.components.bbPosition,
    s.components.supportProx,
    s.components.trendNeutrality,
    s.components.oversoldConsensus,
  ].filter((v): v is number => v !== null);
  if (parts.length === 0) return -1;
  return parts.reduce((acc, x) => acc + x, 0) / parts.length;
}

/**
 * rangeCycleScore → tier 매핑.
 *
 * top: ≥85, strong: 70~84, moderate: 55~69, watch: 40~54, avoid: <40.
 * rangeCycleScore null 이거나 데이터 부족이면 watch (보수적).
 */
export function scoreToTier(rangeCycleScore: number | null): Tier {
  if (rangeCycleScore === null) return 'watch';
  if (rangeCycleScore >= 85) return 'top';
  if (rangeCycleScore >= 70) return 'strong';
  if (rangeCycleScore >= 55) return 'moderate';
  if (rangeCycleScore >= 40) return 'watch';
  return 'avoid';
}

/**
 * Top 8 분포 보장 매핑 — top≤2, strong≤3, moderate≤2, watch≤1, avoid≤1.
 *
 * tier 전체 집계 후 정원 초과분은 스코어 낮은 종목부터 한 단계 아래 tier 로 강등.
 * 정원 부족분은 다음 tier 의 최상위에서 끌어올려 채우지 않는다 — 점수 왜곡 방지.
 */
export function applyTierQuota<T extends { pdno: string; tier: Tier; score: number }>(
  items: ReadonlyArray<T>,
): T[] {
  const QUOTA: Record<Tier, number> = {
    top: 2,
    strong: 3,
    moderate: 2,
    watch: 1,
    avoid: 1,
  };
  const buckets: Record<Tier, T[]> = { top: [], strong: [], moderate: [], watch: [], avoid: [] };
  const sorted = [...items].sort((a, b) => b.score - a.score);
  for (const item of sorted) buckets[item.tier].push(item);

  const result: T[] = [];
  for (const tier of ['top', 'strong', 'moderate', 'watch', 'avoid'] as Tier[]) {
    const slice = buckets[tier].slice(0, QUOTA[tier]);
    for (const it of slice) result.push(it);
  }
  return result;
}

export interface TierDistribution {
  top: number;
  strong: number;
  moderate: number;
  watch: number;
  avoid: number;
}

export function summarizeTiers<T extends { tier: Tier }>(
  items: ReadonlyArray<T>,
): TierDistribution {
  const dist: TierDistribution = { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 };
  for (const item of items) dist[item.tier]++;
  return dist;
}

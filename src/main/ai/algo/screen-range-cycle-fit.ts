import { eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { dailyCandles, stockMaster } from '../../db/schema';
import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';
import { ALGO_THRESHOLDS, computeAlgoSignals } from './algo-signals';

export interface ScreenRangeCycleFitInput {
  db: Db;
  candlesRepo: DailyCandlesRepo;
  /** 최대 후보 개수. 기본 50. */
  cap?: number;
  /** 일봉 최소 개수 — 기본 60. ALGO_THRESHOLDS.minCandlesForFull 와 동일. */
  minCandles?: number;
  /** 사전 제외할 pdno 목록 — A∪B∪C 와 중복 회피용. */
  excludePdnos?: ReadonlySet<string>;
  /** KRX 등 외부 universe 로 이미 1차 선별한 후보. 지정하면 이 목록만 스크리닝. */
  candidatePdnos?: ReadonlyArray<string>;
}

export interface ScreenedCandidate {
  pdno: string;
  name: string;
  rangeCycleScore: number | null;
  /** 통과 사유 — 디버깅/UI 표시용. */
  reasons: ReadonlyArray<string>;
}

/**
 * 박스권 분할매매 사전 스크리닝 (D 풀).
 *
 * 대상: stock_master 종목 중 일봉 캐시 >= minCandles 봉 인 것만.
 * 통과 조건:
 *   1. 반복 회전성 점수 55+.
 *   2. 차수 간격을 만들 수 있는 박스권 폭.
 *   3. 주문 슬리피지를 줄일 수 있는 거래량.
 *   4. 강한 상승/하락 추세가 아닌 중립적 Aroon 구조.
 *
 * LLM 호출 0 — 전부 결정론 알고리즘. cap (기본 50) 으로 잘라 반환.
 */
export function screenRangeCycleFit(input: ScreenRangeCycleFitInput): ScreenedCandidate[] {
  const cap = Math.max(1, input.cap ?? 50);
  const minCandles = input.minCandles ?? ALGO_THRESHOLDS.minCandlesForFull;
  const exclude = input.excludePdnos ?? new Set<string>();

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
  if (eligiblePdnos.length === 0) return [];

  // 종목명 lookup — stock_master 매핑.
  const masters = input.db
    .select({ pdno: stockMaster.pdno, name: stockMaster.name })
    .from(stockMaster)
    .all();
  const nameByPdno = new Map(masters.map((m) => [m.pdno, m.name]));

  // 알고리즘 신호 계산 (cap × 1.5 까지만 — 너무 많이 계산하면 느림).
  const calcCap = Math.min(eligiblePdnos.length, cap * 4);
  const targetPdnos = eligiblePdnos.slice(0, calcCap);
  const signals = computeAlgoSignals({
    candlesRepo: input.candlesRepo,
    pdnos: targetPdnos,
  });

  const passed: ScreenedCandidate[] = [];
  for (const sig of signals) {
    if (sig.rangeCycleScore === null) continue;
    const conditions = evaluateConditions(sig);
    if (!conditions.allPass) continue;
    passed.push({
      pdno: sig.pdno,
      name: nameByPdno.get(sig.pdno) ?? sig.pdno,
      rangeCycleScore: sig.rangeCycleScore,
      reasons: conditions.reasons,
    });
  }

  // rangeCycleScore 내림차순 정렬, cap 적용.
  passed.sort((a, b) => (b.rangeCycleScore ?? 0) - (a.rangeCycleScore ?? 0));
  return passed.slice(0, cap);
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

function evaluateConditions(sig: {
  rangeCycleScore: number | null;
  components: {
    volatility: number | null;
    liquidity: number | null;
    range: number | null;
    trendNeutrality: number | null;
  };
  aroon25: {
    up: number;
    down: number;
    isStrongUpTrend: boolean;
    isStrongDownTrend: boolean;
  } | null;
  rsi14: number | null;
}): { allPass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const scorePass = sig.rangeCycleScore !== null && sig.rangeCycleScore >= 55;
  if (scorePass) reasons.push(`회전성 점수 ${sig.rangeCycleScore}`);

  const volPass = sig.components.volatility !== null && sig.components.volatility >= 60;
  if (volPass) reasons.push('변동성 적정');

  const rangePass = sig.components.range !== null && sig.components.range >= 65;
  if (rangePass) reasons.push('박스권 폭 적정');

  const liqPass = sig.components.liquidity !== null && sig.components.liquidity >= 60;
  if (liqPass) reasons.push('거래량 충분');

  const trendPass =
    !sig.aroon25?.isStrongUpTrend &&
    !sig.aroon25?.isStrongDownTrend &&
    (sig.components.trendNeutrality ?? 0) >= 45;
  if (trendPass) reasons.push('추세 중립');

  return {
    allPass: scorePass && volPass && rangePass && liqPass && trendPass,
    reasons,
  };
}

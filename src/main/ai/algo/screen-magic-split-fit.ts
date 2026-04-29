import { eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { dailyCandles, stockMaster } from '../../db/schema';
import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';
import { ALGO_THRESHOLDS, computeAlgoSignals } from './algo-signals';

export interface ScreenMagicSplitFitInput {
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
  splitScore: number | null;
  /** 통과 사유 — 디버깅/UI 표시용. */
  reasons: ReadonlyArray<string>;
}

/**
 * 매직스플릿 친화 사전 스크리닝 (D 풀).
 *
 * 대상: stock_master 종목 중 일봉 캐시 ≥ minCandles 봉 인 것만.
 * 통과 조건 (4개 모두):
 *   1. 변동성 18~35% (sweet spot)
 *   2. 박스권 25~50% (차수 간격 설계 가능)
 *   3. 평균 거래량 ≥ 10만 (슬리피지 방어)
 *   4. Aroon 추세 약함 (up<70 OR down<70 — 강한 추세장 제외)
 *
 * LLM 호출 0 — 전부 결정론 알고리즘. cap (기본 50) 으로 잘라 반환.
 */
export function screenMagicSplitFit(input: ScreenMagicSplitFitInput): ScreenedCandidate[] {
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
    if (sig.splitScore === null) continue;
    const conditions = evaluateConditions(sig);
    if (!conditions.allPass) continue;
    passed.push({
      pdno: sig.pdno,
      name: nameByPdno.get(sig.pdno) ?? sig.pdno,
      splitScore: sig.splitScore,
      reasons: conditions.reasons,
    });
  }

  // splitScore 내림차순 정렬, cap 적용.
  passed.sort((a, b) => (b.splitScore ?? 0) - (a.splitScore ?? 0));
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
  components: { volatility: number | null; liquidity: number | null; range: number | null };
  aroon25: { up: number; down: number; isStrongUpTrend: boolean } | null;
  rsi14: number | null;
}): { allPass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // 1. 변동성 sweet spot — score 75 이상이면 18~35% 영역에 가까움.
  const volPass = sig.components.volatility !== null && sig.components.volatility >= 75;
  if (volPass) reasons.push('변동성 적정');

  // 2. 박스권 적정 — score 75 이상이면 25~50% 영역.
  const rangePass = sig.components.range !== null && sig.components.range >= 75;
  if (rangePass) reasons.push('박스권 폭 적정');

  // 3. 거래량 충분 — score 60 이상이면 평균 10만+.
  const liqPass = sig.components.liquidity !== null && sig.components.liquidity >= 60;
  if (liqPass) reasons.push('거래량 충분');

  // 4. Aroon 추세 약함 — 강한 상승 추세 X.
  const aroonPass = !sig.aroon25?.isStrongUpTrend;
  if (aroonPass) reasons.push('추세 약함');

  return {
    allPass: volPass && rangePass && liqPass && aroonPass,
    reasons,
  };
}

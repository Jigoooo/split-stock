import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import { ALGO_THRESHOLDS, type AlgoSignals, computeAlgoSignals } from './algo/algo-signals';
import type { RankedMarketContext } from './suggest-symbols';
import { computeSymbolStats, type SymbolStat } from './symbol-stats';

export type DataQuality = 'blocked' | 'limited' | 'normal';
export type AnalysisConfidence = 'high' | 'med' | 'low';

export interface EvidenceRef {
  id: string;
  kind: 'indicator' | 'news' | 'disclosure' | 'market' | 'dataQuality';
  title: string;
  detail: string;
}

export interface RangeCycleFacts {
  pdno: string;
  candleCount: number;
  dataQuality: DataQuality;
  dataQualityReason: string;
  analysisConfidence: AnalysisConfidence;
  stat: SymbolStat;
  algo: AlgoSignals;
  marketContext: RankedMarketContext | null;
  evidenceRefs: EvidenceRef[];
  globalRisks: string[];
}

export interface BuildRangeCycleFactsInput {
  candlesRepo: DailyCandlesRepo;
  pdnos: ReadonlyArray<string>;
  marketContextByPdno?: (pdno: string) => RankedMarketContext | null;
  asOfDate?: string;
}

export function buildRangeCycleFacts(input: BuildRangeCycleFactsInput): RangeCycleFacts[] {
  const asOf = input.asOfDate ?? toKstYmd(new Date());
  const from = shiftYmd(asOf, -240);
  const algos = computeAlgoSignals({
    candlesRepo: input.candlesRepo,
    pdnos: input.pdnos,
    ...(input.asOfDate !== undefined ? { asOfDate: input.asOfDate } : {}),
  });
  const algoByPdno = new Map(algos.map((algo) => [algo.pdno, algo]));
  const stats = computeSymbolStats({
    candlesRepo: input.candlesRepo,
    pdnos: input.pdnos,
    ...(input.asOfDate !== undefined ? { asOfDate: input.asOfDate } : {}),
    precomputedSignals: algoByPdno,
  });
  const statByPdno = new Map(stats.map((stat) => [stat.pdno, stat]));

  return input.pdnos.map((pdno) => {
    const candleCount = input.candlesRepo.getInRange(pdno, 'D', from, asOf).length;
    const dataQuality = classifyDataQuality(candleCount);
    const fallbackAlgo = computeAlgoSignals({ ...input, pdnos: [pdno] })[0];
    const algo = algoByPdno.get(pdno) ?? fallbackAlgo;
    const fallbackStat = computeSymbolStats({ ...input, pdnos: [pdno] })[0];
    const stat = statByPdno.get(pdno) ?? fallbackStat;
    if (!algo || !stat) {
      throw new Error(`RangeCycleFacts 생성 실패: ${pdno}`);
    }
    const marketContext = input.marketContextByPdno?.(pdno) ?? null;
    const evidenceRefs = buildEvidenceRefs(algo, marketContext);
    const globalRisks = buildGlobalRisks(dataQuality, algo, marketContext);
    return {
      pdno,
      candleCount,
      dataQuality,
      dataQualityReason: dataQualityReason(candleCount),
      analysisConfidence: deriveAnalysisConfidence(dataQuality, algo),
      stat,
      algo,
      marketContext,
      evidenceRefs,
      globalRisks,
    };
  });
}

export function classifyDataQuality(candleCount: number): DataQuality {
  if (candleCount < ALGO_THRESHOLDS.minCandlesForBasic) return 'blocked';
  if (candleCount < ALGO_THRESHOLDS.minCandlesForFull) return 'limited';
  return 'normal';
}

interface SymbolDecisionLike {
  score: number;
  tier: string;
  confidence: string;
  cons: string[];
}

export function capSymbolByDataQuality<T extends SymbolDecisionLike>(
  item: T,
  dataQuality: DataQuality,
): T {
  if (dataQuality === 'normal') return item;
  const capped: SymbolDecisionLike = { ...item, confidence: 'low', cons: [...item.cons] };
  if (dataQuality === 'blocked') {
    capped.score = 0;
    capped.tier = 'avoid';
    capped.cons.unshift('일봉 30개 미만으로 자동 추천 차단');
  } else {
    capped.score = Math.min(capped.score, 60);
    if (capped.tier === 'top' || capped.tier === 'strong') capped.tier = 'moderate';
    capped.cons.unshift('일봉 30~59개 limited 구간 — 보수 검토만 허용');
  }
  return { ...item, ...capped };
}

export function dataQualityLabel(value: DataQuality): string {
  if (value === 'blocked') return '데이터 부족';
  if (value === 'limited') return '제한 분석';
  return '정상 분석';
}

function buildEvidenceRefs(
  algo: AlgoSignals | undefined,
  marketContext: RankedMarketContext | null,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const reason of algo?.indicatorReasons ?? []) {
    refs.push({
      id: `indicator:${reason.indicator}`,
      kind: 'indicator',
      title: reason.indicator,
      detail: `${reason.value} - ${reason.meaning}`,
    });
  }
  if (marketContext?.krx) {
    refs.push({
      id: 'market:krx',
      kind: 'market',
      title: 'KRX 시세',
      detail: `${marketContext.krx.date} 종가 ${marketContext.krx.close ?? 'n/a'}, 등락률 ${
        marketContext.krx.changeRate ?? 'n/a'
      }%`,
    });
  }
  for (const point of marketContext?.ecos ?? []) {
    refs.push({
      id: `market:ecos:${point.indicator}`,
      kind: 'market',
      title: `ECOS ${point.indicator}`,
      detail: `${point.value}${point.unitName ?? ''} @ ${point.date}`,
    });
  }
  return refs.slice(0, 12);
}

function buildGlobalRisks(
  dataQuality: DataQuality,
  algo: AlgoSignals | undefined,
  marketContext: RankedMarketContext | null,
): string[] {
  const risks = [...(algo?.conflicts ?? [])];
  if (dataQuality === 'blocked') risks.unshift('일봉 30개 미만으로 추천 보류');
  if (dataQuality === 'limited') risks.unshift('일봉 30~59개로 신뢰도 낮음');
  if (marketContext?.status.krx.isStale) risks.push('KRX 컨텍스트 stale');
  if (marketContext?.status.ecos.isStale) risks.push('ECOS 컨텍스트 stale');
  return risks.slice(0, 8);
}

function deriveAnalysisConfidence(
  dataQuality: DataQuality,
  algo: AlgoSignals | undefined,
): AnalysisConfidence {
  if (dataQuality !== 'normal') return 'low';
  if (algo?.confidence === 'high' && (algo?.conflicts.length ?? 0) === 0) return 'high';
  if (algo?.confidence === 'low') return 'low';
  return 'med';
}

function dataQualityReason(candleCount: number): string {
  if (candleCount < ALGO_THRESHOLDS.minCandlesForBasic) {
    return `일봉 ${candleCount}/${ALGO_THRESHOLDS.minCandlesForBasic}개`;
  }
  if (candleCount < ALGO_THRESHOLDS.minCandlesForFull) {
    return `일봉 ${candleCount}/${ALGO_THRESHOLDS.minCandlesForFull}개`;
  }
  return `일봉 ${candleCount}개`;
}

function shiftYmd(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return toKstYmd(d);
}

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

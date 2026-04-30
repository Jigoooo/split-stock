import type { DailyCandle } from '../../trading/daily-candles-repo';
import { computeConsensus, detectConflicts } from './consensus';
import {
  bbPosition,
  detectMacdCross,
  detectObvDivergence,
  safeAroon,
  safeAtr,
  safeBb,
  safeCci,
  safeMacd,
  safeMfi,
  safeObv,
  safePsar,
  safeRsi,
  safeStoch,
} from './indicator-calculators';
import { round, round1, shiftYmd, toKstYmd } from './math-utils';
import {
  buildIndicatorReasons,
  buildLabels,
  combineRangeCycleScore,
  computeConfidence,
  scoreBbPosition,
  scoreLiquidity,
  scoreOversoldConsensus,
  scoreRange,
  scoreSupportProx,
  scoreTrendNeutrality,
  scoreVolatility,
} from './scoring';
import {
  annualizedVolPct,
  avgVolume,
  computePercentileBox,
  momentum20d,
  percentileRangePct,
  volumeSpikeRatio,
} from './stats';
import { detectSupportResistance, nearestPct } from './support-resistance';
import {
  ALGO_THRESHOLDS,
  type AlgoSignals,
  type AlgoSignalsInput,
  type AlgoThresholds,
  type ConsensusContext,
} from './types';

export type { AlgoSignals, AlgoSignalsInput, AlgoThresholds, ConsensusContext };
export { ALGO_THRESHOLDS, computeConsensus, detectConflicts };

/**
 * 박스권 분할매매 회전성 + 보조 신호 — LLM 호출 전에 결정론적으로 계산.
 *
 * indicatorts 라이브러리의 검증된 함수(bb/macd/rsi/atr/stoch/aroon/obv/mfi/cci/psar)를
 * 사용하고, 회전성 도메인 가드(percentile 박스권 / S·R 클러스터 / consensus /
 * conflicts)를 직접 추가한다.
 */
export function computeAlgoSignals(input: AlgoSignalsInput): AlgoSignals[] {
  const asOf = input.asOfDate ?? toKstYmd(new Date());
  const from = shiftYmd(asOf, -240);
  const T = { ...ALGO_THRESHOLDS, ...(input.thresholds ?? {}) };

  return input.pdnos.map((pdno) => {
    const candles = input.candlesRepo.getInRange(pdno, 'D', from, asOf);
    return computeSingle(pdno, candles, T);
  });
}

function emptySignals(pdno: string, reason: string): AlgoSignals {
  return {
    pdno,
    rangeCycleScore: null,
    components: {
      volatility: null,
      liquidity: null,
      range: null,
      bbPosition: null,
      supportProx: null,
      trendNeutrality: null,
      oversoldConsensus: null,
    },
    box: null,
    bollinger: null,
    macdSignal: null,
    rsi14: null,
    atr14: null,
    stochastic: null,
    aroon25: null,
    divergence: 'none',
    mfi14: null,
    cci20: null,
    psarSignal: null,
    supportResistance: null,
    volumeSpikeRatio: null,
    momentum20d: null,
    consensusCount: 0,
    consensusLevel: 'none',
    consensusDirection: 'none',
    conflicts: [],
    confidence: 'low',
    lastClose: null,
    labels: [reason],
    indicatorReasons: [],
  };
}

function computeSingle(
  pdno: string,
  candles: ReadonlyArray<DailyCandle>,
  T: AlgoThresholds,
): AlgoSignals {
  if (candles.length < T.minCandlesForBasic) {
    return emptySignals(pdno, `데이터 부족(${candles.length}/${T.minCandlesForBasic})`);
  }

  const series = candleSeries(candles);
  const stats = computeBaseStats(candles, T);
  const indicators = computeIndicators(series, candles.length >= T.minCandlesForFull);
  const lastClose = series.closes.at(-1) ?? null;
  const prevClose = series.closes.at(-2) ?? null;

  const bollinger =
    indicators.bb && lastClose !== null
      ? {
          upper: round(indicators.bb.upper),
          middle: round(indicators.bb.middle),
          lower: round(indicators.bb.lower),
          position: bbPosition(lastClose, indicators.bb.upper, indicators.bb.lower),
        }
      : null;
  const macdSignalObj = indicators.macd
    ? {
        line: round(indicators.macd.line),
        signal: round(indicators.macd.signal),
        histogram: round(indicators.macd.histogram),
        cross: detectMacdCross(indicators.macd),
      }
    : null;
  const aroon25 = indicators.aroon
    ? {
        up: round(indicators.aroon.up),
        down: round(indicators.aroon.down),
        isStrongUpTrend:
          indicators.aroon.up >= T.aroonStrongUp && indicators.aroon.down <= T.aroonWeakDown,
        isStrongDownTrend:
          indicators.aroon.down >= T.aroonStrongUp && indicators.aroon.up <= T.aroonWeakDown,
      }
    : null;
  const supportResistance = buildSupportResistance(candles, T, lastClose);
  const ctx: ConsensusContext = {
    rsi: indicators.rsi,
    bbPosition: bollinger?.position ?? null,
    mfi: indicators.mfi,
    stoch: indicators.stoch,
    cci: indicators.cci,
    aroon: aroon25,
    macd: macdSignalObj,
    psar: indicators.psar,
    momentum: stats.momentum,
    divergence: indicators.divergence,
    lastClose,
    prevClose,
    T,
  };
  const consensus = computeConsensus(ctx);
  const components = {
    volatility: scoreVolatility(stats.volPct),
    liquidity: scoreLiquidity(stats.avgVol),
    range: scoreRange(stats.rangePct),
    bbPosition: scoreBbPosition(bollinger?.position ?? null),
    supportProx: scoreSupportProx(supportResistance),
    trendNeutrality: scoreTrendNeutrality(aroon25),
    oversoldConsensus: scoreOversoldConsensus(consensus),
  };

  let rangeCycleScore = combineRangeCycleScore(components);
  if (candles.length < T.minCandlesForFull && rangeCycleScore !== null) {
    rangeCycleScore = Math.min(rangeCycleScore, 30);
  }
  return {
    pdno,
    rangeCycleScore,
    components,
    box: stats.box,
    bollinger,
    macdSignal: macdSignalObj,
    rsi14: indicators.rsi !== null ? round1(indicators.rsi) : null,
    atr14: indicators.atr !== null ? round(indicators.atr) : null,
    stochastic: indicators.stoch
      ? { k: round1(indicators.stoch.k), d: round1(indicators.stoch.d) }
      : null,
    aroon25,
    divergence: indicators.divergence,
    mfi14: indicators.mfi !== null ? round1(indicators.mfi) : null,
    cci20: indicators.cci !== null ? round1(indicators.cci) : null,
    psarSignal: indicators.psar,
    supportResistance,
    volumeSpikeRatio: stats.spike,
    momentum20d: stats.momentum,
    consensusCount: consensus.count,
    consensusLevel: consensus.level,
    consensusDirection: consensus.direction,
    conflicts: detectConflicts(ctx),
    confidence: computeConfidence(candles.length, candles.length >= T.minCandlesForFull, T),
    lastClose,
    labels: buildLabels({
      volPct: stats.volPct,
      rangePct: stats.rangePct,
      rsi: indicators.rsi,
      spike: stats.spike,
      momentum: stats.momentum,
      aroon: aroon25,
      mfi: indicators.mfi,
      consensusLevel: consensus.level,
    }),
    indicatorReasons: buildIndicatorReasons({
      rsi: indicators.rsi,
      bbPosition: bollinger?.position ?? null,
      mfi: indicators.mfi,
      stoch: indicators.stoch,
      aroon: aroon25,
      macd: macdSignalObj,
      psar: indicators.psar,
      momentum: stats.momentum,
      divergence: indicators.divergence,
      atr: indicators.atr,
      cci: indicators.cci,
      supportResistance,
      T,
    }),
  };
}

function candleSeries(candles: ReadonlyArray<DailyCandle>) {
  return {
    closes: candles.map((c) => c.close),
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    volumes: candles.map((c) => c.volume),
  };
}

function computeBaseStats(candles: ReadonlyArray<DailyCandle>, T: AlgoThresholds) {
  const c60 = candles.slice(-60);
  const c120 = candles.slice(-Math.min(120, candles.length));
  return {
    volPct: annualizedVolPct(c60),
    avgVol: avgVolume(c60),
    rangePct: percentileRangePct(c120, T.boxLowPct, T.boxHighPct),
    box: computePercentileBox(c120, T.boxLowPct, T.boxHighPct),
    momentum: momentum20d(candles.slice(-20)),
    spike: volumeSpikeRatio(candles.slice(-5), c60),
  };
}

function computeIndicators(series: ReturnType<typeof candleSeries>, enoughForFull: boolean) {
  const bb = enoughForFull && series.closes.length >= 20 ? safeBb(series.closes) : null;
  const macd = enoughForFull && series.closes.length >= 26 ? safeMacd(series.closes) : null;
  const rsi = series.closes.length >= 15 ? safeRsi(series.closes) : null;
  const atr = series.closes.length >= 15 ? safeAtr(series.highs, series.lows, series.closes) : null;
  const stoch =
    series.closes.length >= 17 ? safeStoch(series.highs, series.lows, series.closes) : null;
  const aroon = series.closes.length >= 25 ? safeAroon(series.highs, series.lows) : null;
  const mfi =
    series.closes.length >= 15
      ? safeMfi(series.highs, series.lows, series.closes, series.volumes)
      : null;
  const cci = series.closes.length >= 20 ? safeCci(series.highs, series.lows, series.closes) : null;
  const psar = safePsar(series.highs, series.lows, series.closes);
  const obv = safeObv(series.closes, series.volumes);
  return {
    bb,
    macd,
    rsi,
    atr,
    stoch,
    aroon,
    mfi,
    cci,
    psar,
    divergence: detectObvDivergence(series.closes, obv),
  };
}

function buildSupportResistance(
  candles: ReadonlyArray<DailyCandle>,
  T: AlgoThresholds,
  lastClose: number | null,
) {
  const sr = candles.length >= 30 ? detectSupportResistance(candles, T) : null;
  return sr && lastClose !== null
    ? {
        supports: sr.supports,
        resistances: sr.resistances,
        nearestSupportPct: nearestPct(lastClose, sr.supports, 'below'),
        nearestResistancePct: nearestPct(lastClose, sr.resistances, 'above'),
      }
    : null;
}

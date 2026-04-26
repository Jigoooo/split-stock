import { aroon, atr, bb, cci, macd, mfi, obv, psar, rsi, stoch } from 'indicatorts';
import type { DailyCandle, DailyCandlesRepo } from '../../trading/daily-candles-repo';

/**
 * 매직스플릿 적합도 + 보조 신호 — LLM 호출 전에 결정론적으로 계산.
 *
 * indicatorts 라이브러리의 검증된 함수(bb/macd/rsi/atr/stoch/aroon/obv/mfi/cci/psar)를 사용하고,
 * 매직스플릿 도메인 가드(percentile 박스권 / S·R 클러스터 / consensus / conflicts) 를 직접 추가.
 */

/** 임계값 — settings 로 노출하면 한국 시장 환경에 맞춰 사용자 조정 가능. */
export const ALGO_THRESHOLDS = {
  /** RSI 과매수/과매도 임계 (한국 변동성 환경 기본 70/30, 보수 75/25). */
  rsiOverbought: 70,
  rsiOversold: 30,
  /** Aroon 강한 추세 판정. up>=70 + down<=30 → 매직스플릿 부적합. */
  aroonStrongUp: 70,
  aroonWeakDown: 30,
  /** MFI 과매수/과매도. */
  mfiOverbought: 80,
  mfiOversold: 20,
  /** Stochastic 과매수/과매도. */
  stochOverbought: 80,
  stochOversold: 20,
  /** 박스권 outlier 제거용 percentile (20·80). */
  boxLowPct: 0.2,
  boxHighPct: 0.8,
  /** 거래량 spike 임계 — 5일 / 60일 비. */
  volumeSpikeRatio: 1.5,
  /** S/R 클러스터: ±1.5% 가격대, swing ±2일 윈도우, 빈도 ≥3, 볼륨 confirm. */
  srClusterPct: 0.015,
  srSwingWindow: 2,
  srMinFrequency: 3,
  /** consensus: 3+ 동의 시 strong, 2 시 moderate, 1 시 weak. */
  consensusStrong: 3,
  consensusModerate: 2,
  /** 데이터 부족 임계 — 60봉 미만이면 splitScore cap 30. */
  minCandlesForFull: 60,
  minCandlesForBasic: 30,
} as const;

export interface AlgoSignals {
  pdno: string;
  /** 매직스플릿 적합도 종합 점수 0~100. composite-score 가 합성. null = 미산출. */
  splitScore: number | null;
  /** 점수의 세부 컴포넌트 — composite-score 에서 가중평균. */
  components: {
    volatility: number | null;
    liquidity: number | null;
    range: number | null;
    bbPosition: number | null;
    supportProx: number | null;
  };
  /** 박스권 자동 탐지 — percentile(20·80) outlier 필터 적용. */
  box: { high: number; low: number; mid: number } | null;
  /** Bollinger Band — period 20, 2σ. position: 0 (lower) ~ 1 (upper). */
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    /** 현재 종가의 BB 내 위치 0~1. */
    position: number | null;
  } | null;
  /** MACD — fast 12 / slow 26 / signal 9. cross: 직전 봉 대비 골든/데드. */
  macdSignal: {
    line: number;
    signal: number;
    histogram: number;
    cross: 'golden' | 'dead' | 'none';
  } | null;
  /** RSI(14). 한국 시장 보수 기본 70/30. */
  rsi14: number | null;
  /** ATR(14) — 평균 진폭. 차수 간격 자동 추천에 활용 (ATR×1.5 등). */
  atr14: number | null;
  /** Stochastic %K/%D — 14·3. */
  stochastic: { k: number; d: number } | null;
  /** Aroon up/down — period 25. ADX 대체 추세 강도 지표. */
  aroon25: { up: number; down: number; isStrongUpTrend: boolean } | null;
  /** OBV 다이버전스 — 가격↗ + OBV↘ bearish, 가격↘ + OBV↗ bullish. */
  divergence: 'bullish' | 'bearish' | 'none';
  /** MFI(14) — 가격+거래량 합성 oscillator. 80+ 과매수 / 20- 과매도. */
  mfi14: number | null;
  /** CCI(20) — momentum oscillator. ±100 임계. */
  cci20: number | null;
  /** PSAR — 손절가 자동 산출. trend: 1 = 상승, -1 = 하락. */
  psarSignal: { value: number; trend: 1 | -1 } | null;
  /** 지지·저항선 — swing high/low ±2일 + ±1.5% 클러스터, 빈도 ≥3, 거래량 confirm. */
  supportResistance: {
    supports: number[];
    resistances: number[];
    nearestSupportPct: number | null;
    nearestResistancePct: number | null;
  } | null;
  /** 5일 평균 거래량 / 60일 평균 거래량 비율 — 1.5+ spike 신호. */
  volumeSpikeRatio: number | null;
  /** 단순 모멘텀 — 20일 수익률 (%). */
  momentum20d: number | null;
  /** 동의(consensus) 한 지표 수 — 3+ 시 strong 라벨에 활용. */
  consensusCount: number;
  /** consensus 라벨 — strong / moderate / weak / none. */
  consensusLevel: 'strong' | 'moderate' | 'weak' | 'none';
  /** 현재 시장 방향에 대한 합의: bullish (oversold 동의) / bearish (overbought 동의) / mixed. */
  consensusDirection: 'bullish' | 'bearish' | 'mixed' | 'none';
  /** 모순 신호 — LLM cons 에 인용. */
  conflicts: string[];
  /** 데이터 신뢰도. */
  confidence: 'high' | 'med' | 'low';
  /** 마지막 종가. */
  lastClose: number | null;
  /** 사람 읽을 수 있는 라벨. UI/LLM 양쪽 사용. */
  labels: string[];
  /** 지표별 사실 기반 사유 — UI 카드 펼침 노출. */
  indicatorReasons: Array<{ indicator: string; value: string; meaning: string }>;
}

export type AlgoThresholds = { -readonly [K in keyof typeof ALGO_THRESHOLDS]: number };

export interface AlgoSignalsInput {
  candlesRepo: DailyCandlesRepo;
  pdnos: ReadonlyArray<string>;
  /** YYYY-MM-DD. 기본 오늘 KST. */
  asOfDate?: string;
  /** 임계값 override — 기본 ALGO_THRESHOLDS. */
  thresholds?: Partial<AlgoThresholds>;
}

export function computeAlgoSignals(input: AlgoSignalsInput): AlgoSignals[] {
  const asOf = input.asOfDate ?? toKstYmd(new Date());
  const from = shiftYmd(asOf, -240); // ~120 영업일 + 여유
  const T = { ...ALGO_THRESHOLDS, ...(input.thresholds ?? {}) };

  return input.pdnos.map((pdno) => {
    const candles = input.candlesRepo.getInRange(pdno, 'D', from, asOf);
    return computeSingle(pdno, candles, T);
  });
}

function emptySignals(pdno: string, reason: string): AlgoSignals {
  return {
    pdno,
    splitScore: null,
    components: {
      volatility: null,
      liquidity: null,
      range: null,
      bbPosition: null,
      supportProx: null,
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

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const c60 = candles.slice(-60);
  const c120 = candles.slice(-Math.min(120, candles.length));
  const c20 = candles.slice(-20);
  const c5 = candles.slice(-5);

  const lastClose = closes[closes.length - 1] ?? null;
  const prevClose = closes[closes.length - 2] ?? null;
  const enoughForFull = candles.length >= T.minCandlesForFull;

  // === 기본 통계 ===
  const volPct = annualizedVolPct(c60);
  const avgVol = avgVolume(c60);
  const rangePct = percentileRangePct(c120, T.boxLowPct, T.boxHighPct);
  const box = computePercentileBox(c120, T.boxLowPct, T.boxHighPct);
  const momentum = momentum20d(c20);
  const spike = volumeSpikeRatio(c5, c60);

  // === indicatorts 라이브러리 호출 ===
  const bbResult = enoughForFull && closes.length >= 20 ? safeBb(closes) : null;
  const macdResult = enoughForFull && closes.length >= 26 ? safeMacd(closes) : null;
  const rsiResult = closes.length >= 15 ? safeRsi(closes) : null;
  const atrResult = closes.length >= 15 ? safeAtr(highs, lows, closes) : null;
  const stochResult = closes.length >= 17 ? safeStoch(highs, lows, closes) : null;
  const aroonResult = closes.length >= 25 ? safeAroon(highs, lows) : null;
  const mfiResult = closes.length >= 15 ? safeMfi(highs, lows, closes, volumes) : null;
  const cciResult = closes.length >= 20 ? safeCci(highs, lows, closes) : null;
  const psarResult = safePsar(highs, lows, closes);
  const obvResult = safeObv(closes, volumes);
  const divergence = detectObvDivergence(closes, obvResult);

  // === Bollinger position ===
  const bollinger =
    bbResult && lastClose !== null
      ? {
          upper: round(bbResult.upper),
          middle: round(bbResult.middle),
          lower: round(bbResult.lower),
          position: bbPosition(lastClose, bbResult.upper, bbResult.lower),
        }
      : null;

  // === MACD cross ===
  const macdSignalObj = macdResult
    ? {
        line: round(macdResult.line),
        signal: round(macdResult.signal),
        histogram: round(macdResult.histogram),
        cross: detectMacdCross(macdResult),
      }
    : null;

  // === Aroon strong-trend 감지 ===
  const aroon25 = aroonResult
    ? {
        up: round(aroonResult.up),
        down: round(aroonResult.down),
        isStrongUpTrend: aroonResult.up >= T.aroonStrongUp && aroonResult.down <= T.aroonWeakDown,
      }
    : null;

  // === 지지·저항 ===
  const sr = candles.length >= 30 ? detectSupportResistance(candles, T) : null;
  const supportResistance =
    sr && lastClose !== null
      ? {
          supports: sr.supports,
          resistances: sr.resistances,
          nearestSupportPct: nearestPct(lastClose, sr.supports, 'below'),
          nearestResistancePct: nearestPct(lastClose, sr.resistances, 'above'),
        }
      : null;

  // === 컴포넌트 점수 ===
  const components = {
    volatility: scoreVolatility(volPct),
    liquidity: scoreLiquidity(avgVol),
    range: scoreRange(rangePct),
    bbPosition: scoreBbPosition(bollinger?.position ?? null),
    supportProx: scoreSupportProx(supportResistance),
  };

  // === splitScore 합성 (composite-score 에서도 사용) ===
  let splitScore = combineScore(components);
  // 데이터 < 60봉이면 cap 30
  if (!enoughForFull && splitScore !== null) {
    splitScore = Math.min(splitScore, 30);
  }

  // === consensus / conflicts / confidence ===
  const ctx: ConsensusContext = {
    rsi: rsiResult,
    bbPosition: bollinger?.position ?? null,
    mfi: mfiResult,
    stoch: stochResult,
    cci: cciResult,
    aroon: aroon25,
    macd: macdSignalObj,
    psar: psarResult,
    momentum,
    divergence,
    lastClose,
    prevClose,
    T,
  };
  const cons = computeConsensus(ctx);
  const conflicts = detectConflicts(ctx);
  const confidence = computeConfidence(candles.length, enoughForFull, T);

  // === 라벨 ===
  const labels = buildLabels({
    volPct,
    rangePct,
    rsi: rsiResult,
    spike,
    momentum,
    aroon: aroon25,
    mfi: mfiResult,
    consensusLevel: cons.level,
  });

  // === 지표별 사유 ===
  const indicatorReasons = buildIndicatorReasons({
    rsi: rsiResult,
    bbPosition: bollinger?.position ?? null,
    mfi: mfiResult,
    stoch: stochResult,
    aroon: aroon25,
    macd: macdSignalObj,
    psar: psarResult,
    momentum,
    divergence,
    atr: atrResult,
    cci: cciResult,
    supportResistance,
    T,
  });

  return {
    pdno,
    splitScore,
    components,
    box,
    bollinger,
    macdSignal: macdSignalObj,
    rsi14: rsiResult !== null ? round1(rsiResult) : null,
    atr14: atrResult !== null ? round(atrResult) : null,
    stochastic: stochResult ? { k: round1(stochResult.k), d: round1(stochResult.d) } : null,
    aroon25,
    divergence,
    mfi14: mfiResult !== null ? round1(mfiResult) : null,
    cci20: cciResult !== null ? round1(cciResult) : null,
    psarSignal: psarResult,
    supportResistance,
    volumeSpikeRatio: spike,
    momentum20d: momentum,
    consensusCount: cons.count,
    consensusLevel: cons.level,
    consensusDirection: cons.direction,
    conflicts,
    confidence,
    lastClose,
    labels,
    indicatorReasons,
  };
}

// ──────────── 통계 ────────────

function annualizedVolPct(candles: ReadonlyArray<DailyCandle>): number | null {
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]?.close ?? 0;
    const curr = candles[i]?.close ?? 0;
    if (prev > 0) returns.push(curr / prev - 1);
  }
  if (returns.length < 5) return null;
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

function avgVolume(candles: ReadonlyArray<DailyCandle>): number {
  if (candles.length === 0) return 0;
  return Math.round(candles.reduce((s, c) => s + c.volume, 0) / candles.length);
}

function percentileRangePct(
  candles: ReadonlyArray<DailyCandle>,
  lowPct: number,
  highPct: number,
): number | null {
  if (candles.length < 10) return null;
  const sortedHighs = candles.map((c) => c.high).sort((a, b) => a - b);
  const sortedLows = candles.map((c) => c.low).sort((a, b) => a - b);
  const high = quantile(sortedHighs, highPct);
  const low = quantile(sortedLows, lowPct);
  if (low <= 0) return null;
  const mid = (high + low) / 2;
  if (mid <= 0) return null;
  return round(((high - low) / mid) * 100);
}

function computePercentileBox(
  candles: ReadonlyArray<DailyCandle>,
  lowPct: number,
  highPct: number,
): { high: number; low: number; mid: number } | null {
  if (candles.length < 10) return null;
  const sortedHighs = candles.map((c) => c.high).sort((a, b) => a - b);
  const sortedLows = candles.map((c) => c.low).sort((a, b) => a - b);
  const high = quantile(sortedHighs, highPct);
  const low = quantile(sortedLows, lowPct);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return {
    high: Math.round(high),
    low: Math.round(low),
    mid: Math.round((high + low) / 2),
  };
}

function quantile(sortedAsc: ReadonlyArray<number>, q: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sortedAsc[base] ?? 0;
  const b = sortedAsc[base + 1] ?? a;
  return a + rest * (b - a);
}

function volumeSpikeRatio(
  recent5: ReadonlyArray<DailyCandle>,
  base60: ReadonlyArray<DailyCandle>,
): number | null {
  if (recent5.length === 0 || base60.length < 30) return null;
  const r5 = recent5.reduce((s, c) => s + c.volume, 0) / recent5.length;
  const r60 = base60.reduce((s, c) => s + c.volume, 0) / base60.length;
  if (r60 <= 0) return null;
  return round(r5 / r60);
}

function momentum20d(c20: ReadonlyArray<DailyCandle>): number | null {
  if (c20.length < 2) return null;
  const first = c20[0]?.close ?? 0;
  const last = c20[c20.length - 1]?.close ?? 0;
  if (first <= 0) return null;
  return round((last / first - 1) * 100);
}

// ──────────── indicatorts 래퍼 (안전 호출) ────────────

function lastFinite(arr: ReadonlyArray<number>): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function safeBb(closes: number[]): { upper: number; middle: number; lower: number } | null {
  try {
    const r = bb(closes, { period: 20 });
    const u = lastFinite(r.upper);
    const m = lastFinite(r.middle);
    const l = lastFinite(r.lower);
    if (u === null || m === null || l === null) return null;
    if (u - l < 1e-6) return null; // std≈0 케이스 — 신뢰성 낮음
    return { upper: u, middle: m, lower: l };
  } catch {
    return null;
  }
}

function safeMacd(
  closes: number[],
): { line: number; signal: number; histogram: number; prevHist: number | null } | null {
  try {
    const r = macd(closes, { fast: 12, slow: 26, signal: 9 });
    const line = lastFinite(r.macdLine);
    const sig = lastFinite(r.signalLine);
    if (line === null || sig === null) return null;
    const hist = line - sig;
    const prevLine = r.macdLine[r.macdLine.length - 2];
    const prevSig = r.signalLine[r.signalLine.length - 2];
    const prevHist =
      typeof prevLine === 'number' &&
      typeof prevSig === 'number' &&
      Number.isFinite(prevLine) &&
      Number.isFinite(prevSig)
        ? prevLine - prevSig
        : null;
    return { line, signal: sig, histogram: hist, prevHist };
  } catch {
    return null;
  }
}

function safeRsi(closes: number[]): number | null {
  try {
    const r = rsi(closes, { period: 14 });
    return lastFinite(r);
  } catch {
    return null;
  }
}

function safeAtr(highs: number[], lows: number[], closes: number[]): number | null {
  try {
    const r = atr(highs, lows, closes, { period: 14 });
    return lastFinite(r.atrLine);
  } catch {
    return null;
  }
}

function safeStoch(
  highs: number[],
  lows: number[],
  closes: number[],
): { k: number; d: number } | null {
  try {
    const r = stoch(highs, lows, closes, { kPeriod: 14, dPeriod: 3 });
    const k = lastFinite(r.k);
    const d = lastFinite(r.d);
    if (k === null || d === null) return null;
    return { k, d };
  } catch {
    return null;
  }
}

function safeAroon(highs: number[], lows: number[]): { up: number; down: number } | null {
  try {
    const r = aroon(highs, lows, { period: 25 });
    const up = lastFinite(r.up);
    const dn = lastFinite(r.down);
    if (up === null || dn === null) return null;
    return { up, down: dn };
  } catch {
    return null;
  }
}

function safeMfi(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number | null {
  try {
    const r = mfi(highs, lows, closes, volumes, { period: 14 });
    return lastFinite(r);
  } catch {
    return null;
  }
}

function safeCci(highs: number[], lows: number[], closes: number[]): number | null {
  try {
    const r = cci(highs, lows, closes, { period: 20 });
    return lastFinite(r);
  } catch {
    return null;
  }
}

function safePsar(
  highs: number[],
  lows: number[],
  closes: number[],
): { value: number; trend: 1 | -1 } | null {
  try {
    const r = psar(highs, lows, closes, { step: 0.02, max: 0.2 });
    const v = lastFinite(r.psarResult);
    const t = r.trends[r.trends.length - 1];
    if (v === null || typeof t !== 'number') return null;
    return { value: round(v), trend: t >= 0 ? 1 : -1 };
  } catch {
    return null;
  }
}

function safeObv(closes: number[], volumes: number[]): number[] | null {
  try {
    return obv(closes, volumes);
  } catch {
    return null;
  }
}

// ──────────── 다이버전스 ────────────

function detectObvDivergence(
  closes: ReadonlyArray<number>,
  obvSeries: ReadonlyArray<number> | null,
): 'bullish' | 'bearish' | 'none' {
  if (!obvSeries || obvSeries.length < 21 || closes.length < 21) return 'none';
  const window = 20;
  const recentClose = closes.slice(-window);
  const recentObv = obvSeries.slice(-window);
  const closeStart = recentClose[0] ?? 0;
  const closeEnd = recentClose[recentClose.length - 1] ?? 0;
  const obvStart = recentObv[0] ?? 0;
  const obvEnd = recentObv[recentObv.length - 1] ?? 0;
  if (closeStart === 0) return 'none';
  const closeChange = (closeEnd - closeStart) / Math.abs(closeStart);
  const obvChange = obvStart === 0 ? 0 : (obvEnd - obvStart) / Math.abs(obvStart);
  // 가격은 의미 있게 변했지만 OBV 가 반대로 — divergence 임계 ±5%.
  if (closeChange > 0.05 && obvChange < -0.05) return 'bearish';
  if (closeChange < -0.05 && obvChange > 0.05) return 'bullish';
  return 'none';
}

function detectMacdCross(m: {
  histogram: number;
  prevHist: number | null;
}): 'golden' | 'dead' | 'none' {
  if (m.prevHist === null) return 'none';
  if (m.prevHist <= 0 && m.histogram > 0) return 'golden';
  if (m.prevHist >= 0 && m.histogram < 0) return 'dead';
  return 'none';
}

// ──────────── 지지·저항 ────────────

function detectSupportResistance(
  candles: ReadonlyArray<DailyCandle>,
  T: AlgoThresholds,
): { supports: number[]; resistances: number[] } {
  const window = T.srSwingWindow;
  const swingHighs: { price: number; volume: number }[] = [];
  const swingLows: { price: number; volume: number }[] = [];
  const avgVol = avgVolume(candles);

  for (let i = window; i < candles.length - window; i++) {
    const center = candles[i];
    if (!center) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = -window; j <= window; j++) {
      if (j === 0) continue;
      const neighbor = candles[i + j];
      if (!neighbor) continue;
      if (neighbor.high > center.high) isHigh = false;
      if (neighbor.low < center.low) isLow = false;
    }
    if (isHigh) swingHighs.push({ price: center.high, volume: center.volume });
    if (isLow) swingLows.push({ price: center.low, volume: center.volume });
  }

  const resistances = clusterPrices(swingHighs, T.srClusterPct, T.srMinFrequency, avgVol);
  const supports = clusterPrices(swingLows, T.srClusterPct, T.srMinFrequency, avgVol);
  return { supports, resistances };
}

function clusterPrices(
  swings: ReadonlyArray<{ price: number; volume: number }>,
  clusterPct: number,
  minFreq: number,
  avgVol: number,
): number[] {
  if (swings.length === 0) return [];
  // 가격 그룹핑: 정렬 후 ±clusterPct 윈도우.
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: { center: number; count: number; volSum: number }[] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(s.price - last.center) / last.center <= clusterPct) {
      last.center = (last.center * last.count + s.price) / (last.count + 1);
      last.count += 1;
      last.volSum += s.volume;
    } else {
      clusters.push({ center: s.price, count: 1, volSum: s.volume });
    }
  }
  return clusters
    .filter((c) => c.count >= minFreq && (avgVol === 0 || c.volSum / c.count >= avgVol * 0.5))
    .map((c) => Math.round(c.center))
    .sort((a, b) => a - b);
}

function nearestPct(
  current: number,
  levels: ReadonlyArray<number>,
  direction: 'above' | 'below',
): number | null {
  if (levels.length === 0 || current <= 0) return null;
  const candidates = levels.filter((l) => (direction === 'above' ? l > current : l < current));
  if (candidates.length === 0) return null;
  const nearest = direction === 'above' ? Math.min(...candidates) : Math.max(...candidates);
  return round((Math.abs(nearest - current) / current) * 100);
}

// ──────────── 컴포넌트 점수 ────────────

function scoreVolatility(volPct: number | null): number | null {
  if (volPct === null) return null;
  if (volPct < 10) return Math.round(volPct * 4);
  if (volPct <= 18) return 60 + Math.round(((volPct - 10) / 8) * 30);
  if (volPct <= 35) return 100 - Math.round(((volPct - 18) / 17) * 10);
  if (volPct <= 60) return 80 - Math.round(((volPct - 35) / 25) * 50);
  return Math.max(0, 30 - Math.round((volPct - 60) / 2));
}

function scoreLiquidity(avgVol: number): number | null {
  if (avgVol <= 0) return 0;
  if (avgVol < 10_000) return Math.min(40, Math.round(avgVol / 250));
  if (avgVol < 100_000) return 40 + Math.round(((avgVol - 10_000) / 90_000) * 20);
  if (avgVol < 1_000_000) return 60 + Math.round(((avgVol - 100_000) / 900_000) * 20);
  if (avgVol < 10_000_000) return 80 + Math.round(((avgVol - 1_000_000) / 9_000_000) * 15);
  return Math.min(100, 95 + Math.round(Math.log10(avgVol / 10_000_000)));
}

function scoreRange(rangePct: number | null): number | null {
  if (rangePct === null) return null;
  if (rangePct < 10) return Math.round(rangePct * 5);
  if (rangePct <= 25) return 50 + Math.round(((rangePct - 10) / 15) * 40);
  if (rangePct <= 50) return 100 - Math.round(((rangePct - 25) / 25) * 10);
  if (rangePct <= 80) return 90 - Math.round(((rangePct - 50) / 30) * 50);
  return Math.max(0, 40 - Math.round((rangePct - 80) / 5));
}

function scoreBbPosition(position: number | null): number | null {
  if (position === null) return null;
  // 매직스플릿: 하단 근접일수록 1차 진입 매력 ↑.
  // position 0 (하단) = 100, 0.5 (중앙) = 60, 1 (상단) = 30.
  if (position < 0) return 100;
  if (position > 1) return 30;
  return Math.round(100 - 70 * position);
}

function scoreSupportProx(
  sr: { nearestSupportPct: number | null; nearestResistancePct: number | null } | null,
): number | null {
  if (!sr || sr.nearestSupportPct === null) return null;
  const pct = sr.nearestSupportPct;
  if (pct <= 1) return 100;
  if (pct <= 3) return 90 - Math.round(((pct - 1) / 2) * 20);
  if (pct <= 7) return 70 - Math.round(((pct - 3) / 4) * 30);
  if (pct <= 15) return 40 - Math.round(((pct - 7) / 8) * 30);
  return Math.max(0, 10 - Math.round((pct - 15) / 5));
}

function combineScore(c: {
  volatility: number | null;
  liquidity: number | null;
  range: number | null;
  bbPosition: number | null;
  supportProx: number | null;
}): number | null {
  // 변동성 0.30 + 유동성 0.20 + 박스권 0.20 + BB 위치 0.15 + 지지프록시 0.15.
  const weights = {
    volatility: 0.3,
    liquidity: 0.2,
    range: 0.2,
    bbPosition: 0.15,
    supportProx: 0.15,
  };
  let sum = 0;
  let weightSum = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = c[key as keyof typeof c];
    if (v !== null) {
      sum += v * w;
      weightSum += w;
    }
  }
  if (weightSum === 0) return null;
  return Math.round(sum / weightSum);
}

function bbPosition(close: number, upper: number, lower: number): number | null {
  if (upper - lower < 1e-6) return null;
  return round((close - lower) / (upper - lower));
}

// ──────────── consensus / conflicts ────────────

export interface ConsensusContext {
  rsi: number | null;
  bbPosition: number | null;
  mfi: number | null;
  stoch: { k: number; d: number } | null;
  cci: number | null;
  aroon: { up: number; down: number; isStrongUpTrend: boolean } | null;
  macd: { cross: 'golden' | 'dead' | 'none'; histogram: number } | null;
  psar: { trend: 1 | -1 } | null;
  momentum: number | null;
  divergence: 'bullish' | 'bearish' | 'none';
  lastClose: number | null;
  prevClose: number | null;
  T: AlgoThresholds;
}

export function computeConsensus(ctx: ConsensusContext): {
  count: number;
  level: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'bullish' | 'bearish' | 'mixed' | 'none';
} {
  let bull = 0;
  let bear = 0;
  if (ctx.rsi !== null) {
    if (ctx.rsi <= ctx.T.rsiOversold) bull++;
    else if (ctx.rsi >= ctx.T.rsiOverbought) bear++;
  }
  if (ctx.bbPosition !== null) {
    if (ctx.bbPosition <= 0.1) bull++;
    else if (ctx.bbPosition >= 0.9) bear++;
  }
  if (ctx.mfi !== null) {
    if (ctx.mfi <= ctx.T.mfiOversold) bull++;
    else if (ctx.mfi >= ctx.T.mfiOverbought) bear++;
  }
  if (ctx.stoch) {
    if (ctx.stoch.k <= ctx.T.stochOversold) bull++;
    else if (ctx.stoch.k >= ctx.T.stochOverbought) bear++;
  }
  if (ctx.cci !== null) {
    if (ctx.cci <= -100) bull++;
    else if (ctx.cci >= 100) bear++;
  }
  if (ctx.divergence === 'bullish') bull++;
  else if (ctx.divergence === 'bearish') bear++;
  if (ctx.macd && ctx.macd.cross === 'golden') bull++;
  else if (ctx.macd && ctx.macd.cross === 'dead') bear++;

  const count = Math.max(bull, bear);
  let direction: 'bullish' | 'bearish' | 'mixed' | 'none';
  if (bull === 0 && bear === 0) direction = 'none';
  else if (bull > 0 && bear > 0) direction = 'mixed';
  else direction = bull > bear ? 'bullish' : 'bearish';

  let level: 'strong' | 'moderate' | 'weak' | 'none';
  if (count === 0) level = 'none';
  else if (count >= ctx.T.consensusStrong) level = 'strong';
  else if (count >= ctx.T.consensusModerate) level = 'moderate';
  else level = 'weak';

  return { count, level, direction };
}

export function detectConflicts(ctx: ConsensusContext): string[] {
  const conflicts: string[] = [];
  // BB 상단 + RSI 과매도 — 불가능에 가까운 조합.
  if (
    ctx.bbPosition !== null &&
    ctx.bbPosition >= 0.9 &&
    ctx.rsi !== null &&
    ctx.rsi <= ctx.T.rsiOversold
  ) {
    conflicts.push('BB 상단 + RSI 과매도 — 모순');
  }
  // BB 하단 + RSI 과매수.
  if (
    ctx.bbPosition !== null &&
    ctx.bbPosition <= 0.1 &&
    ctx.rsi !== null &&
    ctx.rsi >= ctx.T.rsiOverbought
  ) {
    conflicts.push('BB 하단 + RSI 과매수 — 모순');
  }
  // 강한 상승 추세 + 매직스플릿 부적합 경고.
  if (ctx.aroon?.isStrongUpTrend) {
    conflicts.push(
      `Aroon up=${Math.round(ctx.aroon.up)} down=${Math.round(ctx.aroon.down)} — 강한 추세장, 매직스플릿 부적합 가능`,
    );
  }
  // PSAR 하락 추세 + 매수 신호.
  if (
    ctx.psar &&
    ctx.psar.trend === -1 &&
    ((ctx.rsi !== null && ctx.rsi <= ctx.T.rsiOversold) ||
      (ctx.bbPosition !== null && ctx.bbPosition <= 0.1))
  ) {
    conflicts.push('PSAR 하락 추세에서 oversold — 추세 거스르기 위험');
  }
  // OBV 다이버전스가 매수 신호와 충돌.
  if (ctx.divergence === 'bearish' && ctx.bbPosition !== null && ctx.bbPosition <= 0.2) {
    conflicts.push('가격 하단 근접하지만 OBV 베어리시 다이버전스 — 추가 하락 주의');
  }
  return conflicts;
}

function computeConfidence(
  candleCount: number,
  enoughForFull: boolean,
  T: AlgoThresholds,
): 'high' | 'med' | 'low' {
  if (candleCount < T.minCandlesForBasic) return 'low';
  if (!enoughForFull) return 'low';
  if (candleCount >= 90) return 'high';
  return 'med';
}

// ──────────── 라벨 / 사유 ────────────

function buildLabels(args: {
  volPct: number | null;
  rangePct: number | null;
  rsi: number | null;
  spike: number | null;
  momentum: number | null;
  aroon: { up: number; down: number; isStrongUpTrend: boolean } | null;
  mfi: number | null;
  consensusLevel: 'strong' | 'moderate' | 'weak' | 'none';
}): string[] {
  const labels: string[] = [];
  if (args.volPct !== null) {
    if (args.volPct < 12) labels.push('변동성 낮음');
    else if (args.volPct > 40) labels.push('변동성 높음');
    else labels.push('변동성 적정');
  }
  if (args.rangePct !== null) {
    if (args.rangePct < 12) labels.push('박스권 좁음');
    else if (args.rangePct > 60) labels.push('박스권 넓음');
  }
  if (args.rsi !== null) {
    if (args.rsi >= 70) labels.push(`RSI ${round1(args.rsi)} 과매수`);
    else if (args.rsi <= 30) labels.push(`RSI ${round1(args.rsi)} 과매도`);
  }
  if (args.spike !== null && args.spike >= 1.5) {
    labels.push(`거래량 spike ${args.spike}x`);
  }
  if (args.momentum !== null) {
    if (args.momentum >= 10) labels.push(`20일 +${args.momentum}%`);
    else if (args.momentum <= -10) labels.push(`20일 ${args.momentum}%`);
  }
  if (args.aroon?.isStrongUpTrend) labels.push('강한 추세장');
  if (args.mfi !== null) {
    if (args.mfi >= 80) labels.push(`MFI ${round1(args.mfi)} 과매수`);
    else if (args.mfi <= 20) labels.push(`MFI ${round1(args.mfi)} 과매도`);
  }
  if (args.consensusLevel === 'strong') labels.push('합의 강함');
  return labels;
}

function buildIndicatorReasons(args: {
  rsi: number | null;
  bbPosition: number | null;
  mfi: number | null;
  stoch: { k: number; d: number } | null;
  aroon: { up: number; down: number; isStrongUpTrend: boolean } | null;
  macd: { cross: 'golden' | 'dead' | 'none'; histogram: number } | null;
  psar: { trend: 1 | -1; value: number } | null;
  momentum: number | null;
  divergence: 'bullish' | 'bearish' | 'none';
  atr: number | null;
  cci: number | null;
  supportResistance: {
    nearestSupportPct: number | null;
    nearestResistancePct: number | null;
  } | null;
  T: AlgoThresholds;
}): Array<{ indicator: string; value: string; meaning: string }> {
  const out: Array<{ indicator: string; value: string; meaning: string }> = [];
  if (args.rsi !== null) {
    let meaning = '중립권';
    if (args.rsi <= args.T.rsiOversold) meaning = '과매도 — 분할매수 1차 매력';
    else if (args.rsi >= args.T.rsiOverbought) meaning = '과매수 — 추격 매수 위험';
    out.push({ indicator: 'RSI(14)', value: round1(args.rsi).toString(), meaning });
  }
  if (args.bbPosition !== null) {
    let meaning = '밴드 중앙 근처';
    if (args.bbPosition <= 0.1) meaning = '하단 근접 — 분할매수 1차 매력';
    else if (args.bbPosition >= 0.9) meaning = '상단 근접 — 차익 영역';
    out.push({
      indicator: 'BB position',
      value: `${round1(args.bbPosition * 100).toString()}%`,
      meaning,
    });
  }
  if (args.mfi !== null) {
    let meaning = '중립권';
    if (args.mfi <= args.T.mfiOversold) meaning = '거래량 동반 과매도';
    else if (args.mfi >= args.T.mfiOverbought) meaning = '거래량 동반 과매수';
    out.push({ indicator: 'MFI(14)', value: round1(args.mfi).toString(), meaning });
  }
  if (args.stoch) {
    let meaning = '중립권';
    if (args.stoch.k <= args.T.stochOversold) meaning = '과매도 영역';
    else if (args.stoch.k >= args.T.stochOverbought) meaning = '과매수 영역';
    out.push({
      indicator: 'Stochastic',
      value: `K=${round1(args.stoch.k)} D=${round1(args.stoch.d)}`,
      meaning,
    });
  }
  if (args.aroon) {
    let meaning = '추세 약함 — 박스권 매매 적합';
    if (args.aroon.isStrongUpTrend) meaning = '강한 상승 추세 — 매직스플릿 부적합 가능';
    out.push({
      indicator: 'Aroon(25)',
      value: `up=${Math.round(args.aroon.up)} down=${Math.round(args.aroon.down)}`,
      meaning,
    });
  }
  if (args.macd) {
    let meaning = '교차 없음';
    if (args.macd.cross === 'golden') meaning = '골든크로스 — 매수 모멘텀';
    else if (args.macd.cross === 'dead') meaning = '데드크로스 — 매도 모멘텀';
    out.push({
      indicator: 'MACD',
      value: `hist=${round1(args.macd.histogram)}`,
      meaning,
    });
  }
  if (args.psar) {
    out.push({
      indicator: 'PSAR',
      value: `${args.psar.value} (${args.psar.trend === 1 ? '상승' : '하락'})`,
      meaning: args.psar.trend === 1 ? '상승 추세 — PSAR 가 손절선' : '하락 추세 — 추가 하락 위험',
    });
  }
  if (args.momentum !== null) {
    let meaning = '단기 횡보';
    if (args.momentum >= 10) meaning = '단기 강세';
    else if (args.momentum <= -10) meaning = '단기 약세 — 분할매수 매력';
    out.push({ indicator: '20일 모멘텀', value: `${args.momentum}%`, meaning });
  }
  if (args.divergence !== 'none') {
    out.push({
      indicator: 'OBV 다이버전스',
      value: args.divergence,
      meaning:
        args.divergence === 'bullish'
          ? '가격↘ + OBV↗ — 반등 가능성'
          : '가격↗ + OBV↘ — 추가 하락 주의',
    });
  }
  if (args.atr !== null) {
    out.push({
      indicator: 'ATR(14)',
      value: round(args.atr).toString(),
      meaning: `차수 간격 추천: ATR×1.5 ≈ ${Math.round(args.atr * 1.5)} 원 하락 시 진입`,
    });
  }
  if (args.cci !== null) {
    let meaning = '중립권';
    if (args.cci <= -100) meaning = '과매도 영역';
    else if (args.cci >= 100) meaning = '과매수 영역';
    out.push({ indicator: 'CCI(20)', value: round1(args.cci).toString(), meaning });
  }
  if (args.supportResistance) {
    if (args.supportResistance.nearestSupportPct !== null) {
      out.push({
        indicator: '최근접 지지선',
        value: `-${args.supportResistance.nearestSupportPct}%`,
        meaning:
          args.supportResistance.nearestSupportPct <= 3
            ? '지지 근접 — 1차 매수 검토'
            : '지지선 멀음',
      });
    }
    if (args.supportResistance.nearestResistancePct !== null) {
      out.push({
        indicator: '최근접 저항선',
        value: `+${args.supportResistance.nearestResistancePct}%`,
        meaning:
          args.supportResistance.nearestResistancePct <= 3
            ? '저항 근접 — 차익실현 영역'
            : '저항 여유 있음',
      });
    }
  }
  return out;
}

// ──────────── 유틸 ────────────

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

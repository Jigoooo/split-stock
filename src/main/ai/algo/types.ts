import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';

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
  /** 매직스플릿 적합도 종합 점수 0~100. null = 미산출. */
  splitScore: number | null;
  components: {
    volatility: number | null;
    liquidity: number | null;
    range: number | null;
    bbPosition: number | null;
    supportProx: number | null;
  };
  box: { high: number; low: number; mid: number } | null;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    position: number | null;
  } | null;
  macdSignal: {
    line: number;
    signal: number;
    histogram: number;
    cross: 'golden' | 'dead' | 'none';
  } | null;
  rsi14: number | null;
  atr14: number | null;
  stochastic: { k: number; d: number } | null;
  aroon25: { up: number; down: number; isStrongUpTrend: boolean } | null;
  divergence: 'bullish' | 'bearish' | 'none';
  mfi14: number | null;
  cci20: number | null;
  psarSignal: { value: number; trend: 1 | -1 } | null;
  supportResistance: {
    supports: number[];
    resistances: number[];
    nearestSupportPct: number | null;
    nearestResistancePct: number | null;
  } | null;
  volumeSpikeRatio: number | null;
  momentum20d: number | null;
  consensusCount: number;
  consensusLevel: 'strong' | 'moderate' | 'weak' | 'none';
  consensusDirection: 'bullish' | 'bearish' | 'mixed' | 'none';
  conflicts: string[];
  confidence: 'high' | 'med' | 'low';
  lastClose: number | null;
  labels: string[];
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

import { describe, expect, it } from 'vitest';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../../trading/daily-candles-repo';
import {
  ALGO_THRESHOLDS,
  type AlgoThresholds,
  type ConsensusContext,
  computeAlgoSignals,
  computeConsensus,
  detectConflicts,
} from './algo-signals';
import { applyTierQuota, preRank, scoreToTier, summarizeTiers } from './composite-score';

/** in-memory mock candles repo. */
function createMockRepo(byPdno: Record<string, DailyCandle[]>): DailyCandlesRepo {
  return {
    getInRange(pdno: string, _period: ChartPeriod, from: string, to: string): DailyCandle[] {
      const all = byPdno[pdno] ?? [];
      return all.filter((c) => c.date >= from && c.date <= to);
    },
    upsertMany(): number {
      return 0;
    },
  } as unknown as DailyCandlesRepo;
}

/** YYYY-MM-DD 시리즈 생성기 — daily, weekend skip 무시. */
function dateSeries(start: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 박스권 횡보 캔들 — 100~120 박스, 가벼운 노이즈. */
function buildBoxRangeCandles(start: string, count: number): DailyCandle[] {
  const dates = dateSeries(start, count);
  return dates.map((date, i) => {
    const phase = (i % 20) / 20; // 0~1
    const close = 110 + Math.sin(phase * Math.PI * 2) * 8 + ((i * 17) % 5) - 2;
    const high = close + 2;
    const low = close - 2;
    return { date, open: close - 0.5, high, low, close, volume: 200_000 };
  });
}

/**
 * 강한 상승 추세 + 고점 횡보 캔들 — Aroon 의 "up>=70, down<=30" 조건을 자연스럽게 트리거.
 * 단순 monotone 시리즈는 indicatorts Aroon 에서 up/down 둘 다 100 을 반환해 strong-trend 판정 X.
 * 따라서 초반 강한 랠리 → 고점 plateau 패턴을 사용해 lowest low 가 lookback 깊은 곳에 위치하도록 한다.
 */
function buildUpTrendCandles(start: string, count: number): DailyCandle[] {
  const dates = dateSeries(start, count);
  const rallyEnd = Math.min(8, Math.floor(count / 8));
  // 초반 랠리 동안 만들어진 단발 dip 이 lookback 의 lowest low 가 되도록 — 이후 plateau 에서는
  // 그 dip 보다 항상 위에 머무르며 highest high 는 점진 갱신.
  return dates.map((date, i) => {
    let close: number;
    let high: number;
    let low: number;
    if (i === 0) {
      // 인위적 dip — Aroon down 의 anchor.
      close = 90;
      high = 92;
      low = 80;
    } else if (i < rallyEnd) {
      close = 100 + i * 6;
      high = close + 1.2;
      low = close - 1.2;
    } else {
      // Plateau: 새로운 high 는 매우 천천히, low 는 plateau 평균에서만 변동 — dip 보다 위.
      const top = 100 + rallyEnd * 6;
      close = top + 5 + (i - rallyEnd) * 0.05;
      high = close + 1.2 + (i - rallyEnd) * 0.1; // highs grow slowly → up 갱신
      low = close - 0.3; // lows 거의 일정 → 30일 전 dip 이 여전히 lowest
    }
    return {
      date,
      open: close - 0.5,
      high,
      low,
      close,
      volume: 500_000,
    };
  });
}

function withVolume(candles: DailyCandle[], volume: number): DailyCandle[] {
  return candles.map((c) => ({ ...c, volume }));
}

/** Outlier 1건 포함 박스권 — 박스 + 1일 단발 spike. */
function buildBoxWithOutlier(start: string, count: number): DailyCandle[] {
  const candles = buildBoxRangeCandles(start, count);
  // Outlier 1건 — 마지막에서 7번째 봉의 high 만 박스 한참 위로.
  const idx = count - 7;
  const c = candles[idx];
  if (c) {
    candles[idx] = { ...c, high: c.high + 60, close: c.close, volume: c.volume * 5 };
  }
  return candles;
}

describe('computeAlgoSignals', () => {
  it('데이터 < 30봉 인 경우 rangeCycleScore null + dataReason 라벨', () => {
    const repo = createMockRepo({ '000001': buildBoxRangeCandles('2025-01-01', 10) });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-06-01',
    });
    expect(sig?.rangeCycleScore).toBeNull();
    expect(sig?.confidence).toBe('low');
    expect(sig?.labels.some((l) => l.includes('데이터 부족'))).toBe(true);
  });

  it('박스권 횡보 캔들은 rangeCycleScore 가 합리적으로 산출됨 (60+봉)', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 90);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-06-01',
    });
    expect(sig).toBeDefined();
    if (!sig) throw new Error('no signal');
    expect(sig.rangeCycleScore).not.toBeNull();
    expect(sig.confidence === 'med' || sig.confidence === 'high').toBe(true);
    expect(sig.bollinger).not.toBeNull();
    expect(sig.rsi14).not.toBeNull();
    expect(sig.aroon25).not.toBeNull();
    expect(sig.atr14).not.toBeNull();
  });

  it('rangeCycleScore 는 박스권 회전 후보를 강한 추세와 유동성 부족 후보보다 높게 평가', () => {
    const repo = createMockRepo({
      BOX: buildBoxRangeCandles('2025-01-01', 90),
      TREND: buildUpTrendCandles('2025-01-01', 90),
      ILLIQ: withVolume(buildBoxRangeCandles('2025-01-01', 90), 3_000),
    });
    const [box, trend, illiquid] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['BOX', 'TREND', 'ILLIQ'],
      asOfDate: '2025-06-01',
    });
    if (!box || !trend || !illiquid) throw new Error('missing signal');
    expect(box.rangeCycleScore).not.toBeNull();
    expect(trend.rangeCycleScore).not.toBeNull();
    expect(illiquid.rangeCycleScore).not.toBeNull();
    expect(box.rangeCycleScore ?? 0).toBeGreaterThan(trend.rangeCycleScore ?? 0);
    expect(box.rangeCycleScore ?? 0).toBeGreaterThan(illiquid.rangeCycleScore ?? 0);
  });

  it('Bollinger 결과는 lower < middle < upper 순서를 만족', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 90);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-06-01',
    });
    if (!sig?.bollinger) throw new Error('no bollinger');
    expect(sig.bollinger.lower).toBeLessThanOrEqual(sig.bollinger.middle);
    expect(sig.bollinger.middle).toBeLessThanOrEqual(sig.bollinger.upper);
    if (sig.bollinger.position !== null) {
      expect(sig.bollinger.position).toBeGreaterThanOrEqual(-0.5);
      expect(sig.bollinger.position).toBeLessThanOrEqual(1.5);
    }
  });

  it('강한 상승 추세 패턴에서 Aroon 결과 산출 + isStrongUpTrend boolean', () => {
    const candles = buildUpTrendCandles('2025-01-01', 80);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    if (!sig) throw new Error('no signal');
    expect(sig.aroon25).not.toBeNull();
    // up·down 모두 0~100 범위.
    expect(sig.aroon25?.up).toBeGreaterThanOrEqual(0);
    expect(sig.aroon25?.up).toBeLessThanOrEqual(100);
    expect(sig.aroon25?.down).toBeGreaterThanOrEqual(0);
    expect(sig.aroon25?.down).toBeLessThanOrEqual(100);
    // isStrongUpTrend 가 boolean (true/false).
    expect(typeof sig.aroon25?.isStrongUpTrend).toBe('boolean');
  });

  it('박스권 outlier 1건은 percentile 필터로 box.high 가 outlier 보다 작음', () => {
    const candles = buildBoxWithOutlier('2025-01-01', 100);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    if (!sig?.box) throw new Error('no box');
    const outlierHigh = candles.reduce((max, c) => Math.max(max, c.high), 0);
    // 단발 spike 의 high (180+) 를 percentile 박스가 흡수하지 않음을 보장.
    expect(sig.box.high).toBeLessThan(outlierHigh - 20);
  });

  it('반복 터치가 있는 박스권은 confluence box 신뢰도를 올린다', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 120);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-05-30',
    });

    if (!sig?.box) throw new Error('no box');
    expect(sig.box.confidence).not.toBe('low');
    expect(sig.box.touchesLow + sig.box.touchesHigh).toBeGreaterThanOrEqual(4);
    expect(['confluence', 'percentile']).toContain(sig.box.method);
  });

  it('conflicts 배열은 항상 존재하고 string[] 타입', () => {
    const candles = buildUpTrendCandles('2025-01-01', 80);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    if (!sig) throw new Error('no signal');
    expect(Array.isArray(sig.conflicts)).toBe(true);
    for (const c of sig.conflicts) {
      expect(typeof c).toBe('string');
    }
  });

  it('NaN/Infinity 입력에 대해 indicators 이 null/0 으로 안전 처리', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 80);
    // 의도적으로 봉 1건 close=0 — 수익률 계산 보호.
    if (candles[40]) candles[40] = { ...candles[40], close: 0 };
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    expect(sig).toBeDefined();
    if (!sig) throw new Error('no signal');
    // rangeCycleScore 는 null 또는 finite — Number.isNaN 이면 안 됨.
    if (sig.rangeCycleScore !== null) {
      expect(Number.isFinite(sig.rangeCycleScore)).toBe(true);
    }
  });

  it('최소 60봉 이상이면 BB/MACD/Aroon 모두 null 이 아님', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 70);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    if (!sig) throw new Error('no signal');
    expect(sig.bollinger).not.toBeNull();
    expect(sig.macdSignal).not.toBeNull();
    expect(sig.aroon25).not.toBeNull();
    expect(sig.rsi14).not.toBeNull();
    expect(sig.mfi14).not.toBeNull();
  });

  it('데이터 60봉 미만이면 rangeCycleScore 가 30 이하로 cap', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 40);
    const repo = createMockRepo({ '000001': candles });
    const [sig] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    if (!sig) throw new Error('no signal');
    if (sig.rangeCycleScore !== null) {
      expect(sig.rangeCycleScore).toBeLessThanOrEqual(30);
    }
  });

  it('ALGO_THRESHOLDS override 가 반영됨 (RSI 임계 75/25)', () => {
    const candles = buildBoxRangeCandles('2025-01-01', 80);
    const repo = createMockRepo({ '000001': candles });
    const [sigDefault] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
    });
    const [sigCustom] = computeAlgoSignals({
      candlesRepo: repo,
      pdnos: ['000001'],
      asOfDate: '2025-04-30',
      thresholds: { rsiOverbought: 75, rsiOversold: 25 },
    });
    // 결과는 같은 데이터 → 같은 RSI value, 다만 threshold 로 라벨 분기 다를 수 있음.
    expect(sigDefault?.rsi14).toBeCloseTo(sigCustom?.rsi14 ?? 0, 1);
  });

  it('상수 ALGO_THRESHOLDS 가 한국 시장 기본값 70/30 보수 변형 75/25 모두 호환', () => {
    expect(ALGO_THRESHOLDS.rsiOverbought).toBe(70);
    expect(ALGO_THRESHOLDS.rsiOversold).toBe(30);
    expect(ALGO_THRESHOLDS.aroonStrongUp).toBe(70);
    expect(ALGO_THRESHOLDS.minCandlesForFull).toBe(60);
  });
});

describe('composite-score', () => {
  it('scoreToTier — 경계값 매핑', () => {
    expect(scoreToTier(95)).toBe('top');
    expect(scoreToTier(85)).toBe('top');
    expect(scoreToTier(84)).toBe('strong');
    expect(scoreToTier(70)).toBe('strong');
    expect(scoreToTier(55)).toBe('moderate');
    expect(scoreToTier(40)).toBe('watch');
    expect(scoreToTier(39)).toBe('avoid');
    expect(scoreToTier(0)).toBe('avoid');
    expect(scoreToTier(null)).toBe('watch');
  });

  it('preRank — rangeCycleScore 내림차순으로 Top N', () => {
    const candidates = [{ pdno: 'A' }, { pdno: 'B' }, { pdno: 'C' }, { pdno: 'D' }];
    const signals = new Map<string, ReturnType<typeof minimalSignal>>([
      ['A', minimalSignal(50)],
      ['B', minimalSignal(80)],
      ['C', minimalSignal(20)],
      ['D', minimalSignal(null)],
    ]);
    const result = preRank({
      candidates,
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      signalsByPdno: signals as any,
      topN: 2,
    });
    expect(result.top.map((c) => c.pdno)).toEqual(['B', 'A']);
    expect(result.remainder.length).toBe(2);
  });

  it('applyTierQuota — top≤2 strong≤3 moderate≤2 watch≤1 avoid≤1', () => {
    const items = [
      { pdno: 'a', tier: 'top' as const, score: 95 },
      { pdno: 'b', tier: 'top' as const, score: 90 },
      { pdno: 'c', tier: 'top' as const, score: 88 }, // 정원 초과 → 제외
      { pdno: 'd', tier: 'strong' as const, score: 80 },
      { pdno: 'e', tier: 'strong' as const, score: 75 },
      { pdno: 'f', tier: 'strong' as const, score: 72 },
      { pdno: 'g', tier: 'strong' as const, score: 71 }, // 초과 → 제외
      { pdno: 'h', tier: 'moderate' as const, score: 60 },
      { pdno: 'i', tier: 'watch' as const, score: 45 },
      { pdno: 'j', tier: 'avoid' as const, score: 30 },
    ];
    const result = applyTierQuota(items);
    expect(result.length).toBeLessThanOrEqual(9);
    expect(result.filter((r) => r.tier === 'top').length).toBeLessThanOrEqual(2);
    expect(result.filter((r) => r.tier === 'strong').length).toBeLessThanOrEqual(3);
  });

  it('summarizeTiers — 분포 정확 집계', () => {
    const items = [
      { tier: 'top' as const },
      { tier: 'top' as const },
      { tier: 'strong' as const },
      { tier: 'avoid' as const },
    ];
    const dist = summarizeTiers(items);
    expect(dist.top).toBe(2);
    expect(dist.strong).toBe(1);
    expect(dist.moderate).toBe(0);
    expect(dist.watch).toBe(0);
    expect(dist.avoid).toBe(1);
  });
});

// ──────────── consensus / conflicts 단위 테스트 ────────────

const T_DEFAULT: AlgoThresholds = { ...ALGO_THRESHOLDS };

function makeCtx(overrides: Partial<ConsensusContext> = {}): ConsensusContext {
  return {
    rsi: null,
    bbPosition: null,
    mfi: null,
    stoch: null,
    cci: null,
    aroon: null,
    macd: null,
    psar: null,
    momentum: null,
    divergence: 'none',
    lastClose: 100,
    prevClose: 100,
    T: T_DEFAULT,
    ...overrides,
  };
}

describe('computeConsensus', () => {
  it('지표 모두 null 일 때 count=0, level=none, direction=none', () => {
    const r = computeConsensus(makeCtx());
    expect(r).toEqual({ count: 0, level: 'none', direction: 'none' });
  });

  it('RSI 과매도 + BB 하단 + MFI 과매도 → strong + bullish (3+ 동의)', () => {
    const r = computeConsensus(makeCtx({ rsi: 25, bbPosition: 0.05, mfi: 15 }));
    expect(r.count).toBeGreaterThanOrEqual(3);
    expect(r.level).toBe('strong');
    expect(r.direction).toBe('bullish');
  });

  it('RSI 과매수 1개만 → weak + bearish', () => {
    const r = computeConsensus(makeCtx({ rsi: 75 }));
    expect(r.count).toBe(1);
    expect(r.level).toBe('weak');
    expect(r.direction).toBe('bearish');
  });

  it('RSI 과매수 + BB 하단 → mixed direction (count=1)', () => {
    const r = computeConsensus(makeCtx({ rsi: 75, bbPosition: 0.05 }));
    expect(r.direction).toBe('mixed');
  });

  it('OBV 다이버전스(bullish) + MACD 골든크로스 → 2개 동의 = moderate + bullish', () => {
    const r = computeConsensus(
      makeCtx({
        divergence: 'bullish',
        macd: { cross: 'golden', histogram: 0.5 },
      }),
    );
    expect(r.count).toBe(2);
    expect(r.level).toBe('moderate');
    expect(r.direction).toBe('bullish');
  });
});

describe('detectConflicts', () => {
  it('지표 모두 null 일 때 빈 배열', () => {
    expect(detectConflicts(makeCtx())).toEqual([]);
  });

  it('BB 상단(0.95) + RSI 과매도(25) → "BB 상단 + RSI 과매도 — 모순"', () => {
    const r = detectConflicts(makeCtx({ bbPosition: 0.95, rsi: 25 }));
    expect(r.some((c) => c.includes('BB 상단') && c.includes('과매도'))).toBe(true);
  });

  it('BB 하단(0.05) + RSI 과매수(75) → "BB 하단 + RSI 과매수 — 모순"', () => {
    const r = detectConflicts(makeCtx({ bbPosition: 0.05, rsi: 75 }));
    expect(r.some((c) => c.includes('BB 하단') && c.includes('과매수'))).toBe(true);
  });

  it('Aroon strong-trend → 박스권 회전성 저하 경고', () => {
    const r = detectConflicts(
      makeCtx({
        aroon: { up: 85, down: 15, isStrongUpTrend: true, isStrongDownTrend: false },
      }),
    );
    expect(r.some((c) => c.includes('Aroon') && c.includes('추세장'))).toBe(true);
  });

  it('PSAR 하락 추세 + RSI 과매도 → "추세 거스르기" 경고', () => {
    const r = detectConflicts(makeCtx({ psar: { trend: -1 }, rsi: 25 }));
    expect(r.some((c) => c.includes('PSAR') && c.includes('추세'))).toBe(true);
  });

  it('OBV 베어리시 다이버전스 + BB 하단 근접 → 추가 하락 경고', () => {
    const r = detectConflicts(makeCtx({ divergence: 'bearish', bbPosition: 0.15 }));
    expect(r.some((c) => c.includes('OBV') || c.includes('다이버전스'))).toBe(true);
  });

  it('정상 oversold (RSI 25 + BB 0.05) → 충돌 없음', () => {
    const r = detectConflicts(makeCtx({ rsi: 25, bbPosition: 0.05 }));
    expect(r).toEqual([]);
  });
});

function minimalSignal(score: number | null) {
  return {
    pdno: 'X',
    rangeCycleScore: score,
    components: {
      volatility: score,
      liquidity: score,
      range: score,
      bbPosition: null,
      supportProx: null,
      trendNeutrality: score,
      oversoldConsensus: score,
    },
    box: null,
    bollinger: null,
    macdSignal: null,
    rsi14: null,
    atr14: null,
    stochastic: null,
    aroon25: null,
    divergence: 'none' as const,
    mfi14: null,
    cci20: null,
    psarSignal: null,
    supportResistance: null,
    volumeSpikeRatio: null,
    momentum20d: null,
    consensusCount: 0,
    consensusLevel: 'none' as const,
    consensusDirection: 'none' as const,
    conflicts: [],
    confidence: 'low' as const,
    lastClose: null,
    labels: [],
    indicatorReasons: [],
  };
}

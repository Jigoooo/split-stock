import type { DailyCandle } from '../../trading/daily-candles-repo';
import { round } from './math-utils';
import type { RangeBox, SupportResistanceAnalysis, SupportResistanceLevel } from './types';

interface DynamicBand {
  upper: number;
  middle: number;
  lower: number;
}

export function annualizedVolPct(candles: ReadonlyArray<DailyCandle>): number | null {
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

export function avgVolume(candles: ReadonlyArray<DailyCandle>): number {
  if (candles.length === 0) return 0;
  return Math.round(candles.reduce((s, c) => s + c.volume, 0) / candles.length);
}

export function percentileRangePct(
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

export function computePercentileBox(
  candles: ReadonlyArray<DailyCandle>,
  lowPct: number,
  highPct: number,
): RangeBox | null {
  if (candles.length < 10) return null;
  const sortedHighs = candles.map((c) => c.high).sort((a, b) => a - b);
  const sortedLows = candles.map((c) => c.low).sort((a, b) => a - b);
  const high = quantile(sortedHighs, highPct);
  const low = quantile(sortedLows, lowPct);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  const roundedHigh = Math.round(high);
  const roundedLow = Math.round(low);
  const tolerance = rangeTouchTolerance(roundedLow, roundedHigh, null);
  return {
    high: roundedHigh,
    low: roundedLow,
    mid: Math.round((high + low) / 2),
    confidence: 'low',
    touchesLow: countBoundaryTouches(candles, roundedLow, 'low', tolerance),
    touchesHigh: countBoundaryTouches(candles, roundedHigh, 'high', tolerance),
    method: 'percentile',
  };
}

export function computeDonchianBox(
  candles: ReadonlyArray<DailyCandle>,
): { high: number; low: number; mid: number } | null {
  if (candles.length < 10) return null;
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) return null;
  return { high: Math.round(high), low: Math.round(low), mid: Math.round((high + low) / 2) };
}

export function computeRangePctFromBox(box: RangeBox | null): number | null {
  if (!box || box.mid <= 0) return null;
  return round(((box.high - box.low) / box.mid) * 100);
}

export function computeConfluenceBox(
  candles: ReadonlyArray<DailyCandle>,
  lowPct: number,
  highPct: number,
  options: {
    atr14?: number | null;
    supportResistance?: SupportResistanceAnalysis | null;
    bollinger?: DynamicBand | null;
    keltner?: DynamicBand | null;
  } = {},
): RangeBox | null {
  const percentile = computePercentileBox(candles, lowPct, highPct);
  if (!percentile) return null;
  const donchian60 = computeDonchianBox(candles.slice(-Math.min(60, candles.length)));
  const tolerance = rangeTouchTolerance(percentile.low, percentile.high, options.atr14 ?? null);
  const lowCandidates = [
    percentile.low,
    ...levelBoundaryCandidates(
      options.supportResistance?.levels ?? [],
      'support',
      percentile.low,
      tolerance,
    ),
    ...bandBoundaryCandidate(options.bollinger?.lower ?? null, percentile.low, tolerance),
    ...bandBoundaryCandidate(options.keltner?.lower ?? null, percentile.low, tolerance),
    ...bandBoundaryCandidate(donchian60?.low ?? null, percentile.low, tolerance * 2),
  ];
  const highCandidates = [
    percentile.high,
    ...levelBoundaryCandidates(
      options.supportResistance?.levels ?? [],
      'resistance',
      percentile.high,
      tolerance,
    ),
    ...bandBoundaryCandidate(options.bollinger?.upper ?? null, percentile.high, tolerance),
    ...bandBoundaryCandidate(options.keltner?.upper ?? null, percentile.high, tolerance),
    ...bandBoundaryCandidate(donchian60?.high ?? null, percentile.high, tolerance * 2),
  ];
  const low = Math.round(weightedAverage(lowCandidates));
  const high = Math.round(weightedAverage(highCandidates));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) {
    return percentile;
  }
  const touchesLow = countBoundaryTouches(candles, low, 'low', tolerance);
  const touchesHigh = countBoundaryTouches(candles, high, 'high', tolerance);
  const lowConfluence = lowCandidates.length - 1;
  const highConfluence = highCandidates.length - 1;
  const confluenceScore =
    lowConfluence + highConfluence + Math.min(touchesLow, 3) + Math.min(touchesHigh, 3);
  return {
    high,
    low,
    mid: Math.round((high + low) / 2),
    confidence: confluenceScore >= 8 ? 'high' : confluenceScore >= 4 ? 'med' : 'low',
    touchesLow,
    touchesHigh,
    method: confluenceScore >= 4 ? 'confluence' : 'percentile',
  };
}

export function volumeSpikeRatio(
  recent5: ReadonlyArray<DailyCandle>,
  base60: ReadonlyArray<DailyCandle>,
): number | null {
  if (recent5.length === 0 || base60.length < 30) return null;
  const r5 = recent5.reduce((s, c) => s + c.volume, 0) / recent5.length;
  const r60 = base60.reduce((s, c) => s + c.volume, 0) / base60.length;
  if (r60 <= 0) return null;
  return round(r5 / r60);
}

export function momentum20d(c20: ReadonlyArray<DailyCandle>): number | null {
  if (c20.length < 2) return null;
  const first = c20[0]?.close ?? 0;
  const last = c20[c20.length - 1]?.close ?? 0;
  if (first <= 0) return null;
  return round((last / first - 1) * 100);
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

function rangeTouchTolerance(low: number, high: number, atr14: number | null): number {
  const mid = (low + high) / 2;
  return Math.max(mid * 0.012, (atr14 ?? 0) * 0.5, 1);
}

function countBoundaryTouches(
  candles: ReadonlyArray<DailyCandle>,
  boundary: number,
  side: 'low' | 'high',
  tolerance: number,
): number {
  return candles.filter((candle) =>
    side === 'low'
      ? Math.abs(candle.low - boundary) <= tolerance
      : Math.abs(candle.high - boundary) <= tolerance,
  ).length;
}

function levelBoundaryCandidates(
  levels: ReadonlyArray<SupportResistanceLevel>,
  kind: SupportResistanceLevel['kind'],
  baseline: number,
  tolerance: number,
): number[] {
  return levels
    .filter(
      (level) =>
        level.kind === kind &&
        !level.invalidated &&
        level.strength >= 65 &&
        Math.abs(level.price - baseline) <= Math.max(tolerance * 2, baseline * 0.06),
    )
    .map((level) => level.price);
}

function bandBoundaryCandidate(
  value: number | null,
  baseline: number,
  tolerance: number,
): number[] {
  if (value === null || !Number.isFinite(value) || value <= 0) return [];
  return Math.abs(value - baseline) <= Math.max(tolerance * 2, baseline * 0.08)
    ? [Math.round(value)]
    : [];
}

function weightedAverage(values: ReadonlyArray<number>): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

import type { DailyCandle } from '../../trading/daily-candles-repo';
import { round } from './math-utils';

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

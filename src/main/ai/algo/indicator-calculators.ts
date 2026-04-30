import { aroon, atr, bb, cci, macd, mfi, obv, psar, rsi, stoch } from 'indicatorts';
import { round } from './math-utils';

export function safeBb(closes: number[]): { upper: number; middle: number; lower: number } | null {
  try {
    const r = bb(closes, { period: 20 });
    const u = lastFinite(r.upper);
    const m = lastFinite(r.middle);
    const l = lastFinite(r.lower);
    if (u === null || m === null || l === null) return null;
    if (u - l < 1e-6) return null;
    return { upper: u, middle: m, lower: l };
  } catch {
    return null;
  }
}

export function safeMacd(
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

export function safeRsi(closes: number[]): number | null {
  try {
    const r = rsi(closes, { period: 14 });
    return lastFinite(r);
  } catch {
    return null;
  }
}

export function safeAtr(highs: number[], lows: number[], closes: number[]): number | null {
  try {
    const r = atr(highs, lows, closes, { period: 14 });
    return lastFinite(r.atrLine);
  } catch {
    return null;
  }
}

export function safeStoch(
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

export function safeAroon(highs: number[], lows: number[]): { up: number; down: number } | null {
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

export function safeMfi(
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

export function safeCci(highs: number[], lows: number[], closes: number[]): number | null {
  try {
    const r = cci(highs, lows, closes, { period: 20 });
    return lastFinite(r);
  } catch {
    return null;
  }
}

export function safePsar(
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

export function safeObv(closes: number[], volumes: number[]): number[] | null {
  try {
    return obv(closes, volumes);
  } catch {
    return null;
  }
}

export function detectObvDivergence(
  closes: ReadonlyArray<number>,
  obvSeries: ReadonlyArray<number> | null,
): 'bullish' | 'bearish' | 'none' {
  if (!obvSeries || obvSeries.length < 21 || closes.length < 21) return 'none';
  const recentClose = closes.slice(-20);
  const recentObv = obvSeries.slice(-20);
  const closeStart = recentClose[0] ?? 0;
  const closeEnd = recentClose[recentClose.length - 1] ?? 0;
  const obvStart = recentObv[0] ?? 0;
  const obvEnd = recentObv[recentObv.length - 1] ?? 0;
  if (closeStart === 0) return 'none';
  const closeChange = (closeEnd - closeStart) / Math.abs(closeStart);
  const obvChange = obvStart === 0 ? 0 : (obvEnd - obvStart) / Math.abs(obvStart);
  if (closeChange > 0.05 && obvChange < -0.05) return 'bearish';
  if (closeChange < -0.05 && obvChange > 0.05) return 'bullish';
  return 'none';
}

export function detectMacdCross(m: {
  histogram: number;
  prevHist: number | null;
}): 'golden' | 'dead' | 'none' {
  if (m.prevHist === null) return 'none';
  if (m.prevHist <= 0 && m.histogram > 0) return 'golden';
  if (m.prevHist >= 0 && m.histogram < 0) return 'dead';
  return 'none';
}

export function bbPosition(close: number, upper: number, lower: number): number | null {
  if (upper - lower < 1e-6) return null;
  return round((close - lower) / (upper - lower));
}

function lastFinite(arr: ReadonlyArray<number>): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

import type { DailyCandle } from '../../trading/daily-candles-repo';
import { round } from './math-utils';
import { avgVolume } from './stats';
import type { AlgoThresholds } from './types';

export function detectSupportResistance(
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

export function nearestPct(
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

function clusterPrices(
  swings: ReadonlyArray<{ price: number; volume: number }>,
  clusterPct: number,
  minFreq: number,
  avgVol: number,
): number[] {
  if (swings.length === 0) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: { center: number; count: number; volSum: number }[] = [];
  for (const swing of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(swing.price - last.center) / last.center <= clusterPct) {
      last.center = (last.center * last.count + swing.price) / (last.count + 1);
      last.count += 1;
      last.volSum += swing.volume;
    } else {
      clusters.push({ center: swing.price, count: 1, volSum: swing.volume });
    }
  }
  return clusters
    .filter(
      (cluster) =>
        cluster.count >= minFreq &&
        (avgVol === 0 || cluster.volSum / cluster.count >= avgVol * 0.5),
    )
    .map((cluster) => Math.round(cluster.center))
    .sort((a, b) => a - b);
}

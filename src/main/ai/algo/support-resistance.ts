import type { DailyCandle } from '../../trading/daily-candles-repo';
import { round } from './math-utils';
import { avgVolume } from './stats';
import type {
  AlgoThresholds,
  RangeBox,
  SupportResistanceAnalysis,
  SupportResistanceKind,
  SupportResistanceLevel,
  SupportResistanceSource,
} from './types';

interface DynamicBand {
  upper: number;
  middle: number;
  lower: number;
}

export interface DetectSupportResistanceOptions {
  atr14?: number | null;
  percentileBox?: RangeBox | null;
  bollinger?: DynamicBand | null;
  donchian?: { high: number; low: number } | null;
  keltner?: DynamicBand | null;
  lastClose?: number | null;
}

interface SwingPoint {
  kind: SupportResistanceKind;
  price: number;
  volume: number;
  index: number;
  date: string;
}

interface LevelCluster {
  kind: SupportResistanceKind;
  center: number;
  points: SwingPoint[];
}

export function detectSupportResistance(
  candles: ReadonlyArray<DailyCandle>,
  T: AlgoThresholds,
  options: DetectSupportResistanceOptions = {},
): SupportResistanceAnalysis {
  const avgVol = avgVolume(candles);
  const swings = detectConfirmedSwings(candles, T.srSwingWindow);
  const levels = buildLevels(candles, swings, T, avgVol, options);
  const supports = activePrices(levels, 'support');
  const resistances = activePrices(levels, 'resistance');
  const lastClose = options.lastClose ?? candles.at(-1)?.close ?? null;
  const nearestSupport = findNearestLevel(lastClose, levels, 'support');
  const nearestResistance = findNearestLevel(lastClose, levels, 'resistance');

  return {
    supports,
    resistances,
    nearestSupportPct:
      lastClose !== null && nearestSupport ? distancePct(lastClose, nearestSupport.price) : null,
    nearestResistancePct:
      lastClose !== null && nearestResistance
        ? distancePct(lastClose, nearestResistance.price)
        : null,
    nearestSupport,
    nearestResistance,
    levels,
  };
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

function detectConfirmedSwings(candles: ReadonlyArray<DailyCandle>, window: number): SwingPoint[] {
  const swings: SwingPoint[] = [];
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
    if (isHigh) {
      swings.push({
        kind: 'resistance',
        price: center.high,
        volume: center.volume,
        index: i,
        date: center.date,
      });
    }
    if (isLow) {
      swings.push({
        kind: 'support',
        price: center.low,
        volume: center.volume,
        index: i,
        date: center.date,
      });
    }
  }
  return swings;
}

function buildLevels(
  candles: ReadonlyArray<DailyCandle>,
  swings: ReadonlyArray<SwingPoint>,
  T: AlgoThresholds,
  avgVol: number,
  options: DetectSupportResistanceOptions,
): SupportResistanceLevel[] {
  const clusters = [
    ...clusterSwings(
      swings.filter((s) => s.kind === 'support'),
      T,
      options.atr14 ?? null,
    ),
    ...clusterSwings(
      swings.filter((s) => s.kind === 'resistance'),
      T,
      options.atr14 ?? null,
    ),
  ];
  return clusters
    .filter((cluster) => cluster.points.length >= T.srMinFrequency)
    .map((cluster) => buildLevel(candles, cluster, avgVol, options))
    .sort((a, b) => a.price - b.price);
}

function clusterSwings(
  swings: ReadonlyArray<SwingPoint>,
  T: AlgoThresholds,
  atr14: number | null,
): LevelCluster[] {
  if (swings.length === 0) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: LevelCluster[] = [];
  for (const swing of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && isWithinCluster(swing.price, last.center, T.srClusterPct, atr14)) {
      last.center = (last.center * last.points.length + swing.price) / (last.points.length + 1);
      last.points.push(swing);
    } else {
      clusters.push({ kind: swing.kind, center: swing.price, points: [swing] });
    }
  }
  return clusters;
}

function isWithinCluster(
  price: number,
  center: number,
  clusterPct: number,
  atr14: number | null,
): boolean {
  const tolerance = Math.max(center * clusterPct, (atr14 ?? 0) * 0.5);
  return Math.abs(price - center) <= tolerance;
}

function buildLevel(
  candles: ReadonlyArray<DailyCandle>,
  cluster: LevelCluster,
  avgVol: number,
  options: DetectSupportResistanceOptions,
): SupportResistanceLevel {
  const price = Math.round(cluster.center);
  const zoneHalfWidth = Math.max(price * 0.004, (options.atr14 ?? 0) * 0.5);
  const zoneLow = Math.max(1, Math.round(price - zoneHalfWidth));
  const zoneHigh = Math.round(price + zoneHalfWidth);
  const lastPoint = cluster.points.reduce((latest, point) =>
    point.index > latest.index ? point : latest,
  );
  const ageBars = Math.max(0, candles.length - 1 - lastPoint.index);
  const bouncePct = maxBouncePct(candles, cluster.points, cluster.kind);
  const avgPivotVol = avgVolume(cluster.points.map(toVolumeOnlyCandle));
  const volumeRatio = avgVol > 0 ? round(avgPivotVol / avgVol) : 0;
  const invalidated = isInvalidated(candles, cluster.kind, zoneLow, zoneHigh);
  const sources = levelSources({
    kind: cluster.kind,
    price,
    zoneLow,
    zoneHigh,
    touchCount: cluster.points.length,
    bouncePct,
    volumeRatio,
    options,
  });

  return {
    kind: cluster.kind,
    price,
    zoneLow,
    zoneHigh,
    strength: levelStrength({
      touchCount: cluster.points.length,
      ageBars,
      bouncePct,
      volumeRatio,
      invalidated,
      sourceCount: sources.length,
      atrPct: atrPct(price, options.atr14 ?? null),
    }),
    touchCount: cluster.points.length,
    lastTouchedDate: lastPoint.date,
    ageBars,
    bouncePct,
    volumeRatio,
    invalidated,
    sources,
  };
}

function toVolumeOnlyCandle(point: SwingPoint): DailyCandle {
  return {
    date: point.date,
    open: point.price,
    high: point.price,
    low: point.price,
    close: point.price,
    volume: point.volume,
  };
}

function maxBouncePct(
  candles: ReadonlyArray<DailyCandle>,
  points: ReadonlyArray<SwingPoint>,
  kind: SupportResistanceKind,
): number {
  let maxPct = 0;
  for (const point of points) {
    const after = candles.slice(point.index + 1, Math.min(candles.length, point.index + 11));
    if (after.length === 0 || point.price <= 0) continue;
    const pct =
      kind === 'support'
        ? ((Math.max(...after.map((c) => c.high)) - point.price) / point.price) * 100
        : ((point.price - Math.min(...after.map((c) => c.low))) / point.price) * 100;
    if (Number.isFinite(pct)) maxPct = Math.max(maxPct, pct);
  }
  return round(maxPct);
}

function isInvalidated(
  candles: ReadonlyArray<DailyCandle>,
  kind: SupportResistanceKind,
  zoneLow: number,
  zoneHigh: number,
): boolean {
  const recent = candles.slice(-8);
  const breaks = recent.filter((candle) =>
    kind === 'support' ? candle.close < zoneLow : candle.close > zoneHigh,
  ).length;
  return breaks >= 2;
}

function levelSources(args: {
  kind: SupportResistanceKind;
  price: number;
  zoneLow: number;
  zoneHigh: number;
  touchCount: number;
  bouncePct: number;
  volumeRatio: number;
  options: DetectSupportResistanceOptions;
}): SupportResistanceSource[] {
  const sources: SupportResistanceSource[] = ['pivot'];
  if (args.touchCount >= 2) sources.push('repeat-touch');
  if (args.bouncePct >= Math.max(2, atrPct(args.price, args.options.atr14 ?? null) * 1.5)) {
    sources.push('bounce');
  }
  if (args.volumeRatio >= 1) sources.push('volume');
  if (isNearBoundary(args.price, args.kind, args.options.percentileBox)) sources.push('box');
  if (isNearBand(args.price, args.kind, args.options.bollinger)) sources.push('bollinger');
  if (isNearBand(args.price, args.kind, args.options.keltner)) sources.push('keltner');
  if (isNearDonchian(args.price, args.kind, args.options.donchian)) sources.push('donchian');
  return Array.from(new Set(sources));
}

function isNearBoundary(
  price: number,
  kind: SupportResistanceKind,
  box: RangeBox | null | undefined,
): boolean {
  if (!box) return false;
  const boundary = kind === 'support' ? box.low : box.high;
  return Math.abs(price - boundary) / boundary <= 0.03;
}

function isNearBand(
  price: number,
  kind: SupportResistanceKind,
  band: DynamicBand | null | undefined,
): boolean {
  if (!band) return false;
  const boundary = kind === 'support' ? band.lower : band.upper;
  return boundary > 0 && Math.abs(price - boundary) / boundary <= 0.03;
}

function isNearDonchian(
  price: number,
  kind: SupportResistanceKind,
  donchian: { high: number; low: number } | null | undefined,
): boolean {
  if (!donchian) return false;
  const boundary = kind === 'support' ? donchian.low : donchian.high;
  return boundary > 0 && Math.abs(price - boundary) / boundary <= 0.03;
}

function levelStrength(args: {
  touchCount: number;
  ageBars: number;
  bouncePct: number;
  volumeRatio: number;
  invalidated: boolean;
  sourceCount: number;
  atrPct: number;
}): number {
  let strength = 25;
  strength += Math.min(args.touchCount, 6) * 8;
  if (args.ageBars <= 20) strength += 18;
  else if (args.ageBars <= 60) strength += 12;
  else if (args.ageBars <= 120) strength += 6;
  if (args.bouncePct >= Math.max(2, args.atrPct * 1.5)) strength += 16;
  else if (args.bouncePct >= args.atrPct) strength += 10;
  else if (args.bouncePct > 0) strength += 4;
  if (args.volumeRatio >= 1.5) strength += 10;
  else if (args.volumeRatio >= 1) strength += 6;
  else if (args.volumeRatio >= 0.5) strength += 2;
  strength += Math.max(0, args.sourceCount - 2) * 4;
  if (args.invalidated) strength -= 35;
  return clamp(Math.round(strength), 0, 100);
}

function activePrices(
  levels: ReadonlyArray<SupportResistanceLevel>,
  kind: SupportResistanceKind,
): number[] {
  return levels
    .filter((level) => level.kind === kind && !level.invalidated && level.strength >= 35)
    .map((level) => level.price)
    .sort((a, b) => a - b);
}

function findNearestLevel(
  current: number | null,
  levels: ReadonlyArray<SupportResistanceLevel>,
  kind: SupportResistanceKind,
): SupportResistanceLevel | null {
  if (current === null || current <= 0) return null;
  const candidates = levels.filter((level) => {
    if (level.kind !== kind || level.invalidated || level.strength < 35) return false;
    return kind === 'support' ? level.price < current : level.price > current;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, level) =>
    kind === 'support'
      ? level.price > best.price
        ? level
        : best
      : level.price < best.price
        ? level
        : best,
  );
}

function distancePct(current: number, level: number): number {
  return round((Math.abs(level - current) / current) * 100);
}

function atrPct(price: number, atr14: number | null): number {
  if (!atr14 || price <= 0) return 0;
  return (atr14 / price) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

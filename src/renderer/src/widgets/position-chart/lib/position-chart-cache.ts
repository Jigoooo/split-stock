import type { Candle, ChartPeriod } from '../model/candle-types';

function chartCacheKey(pdno: string, period: ChartPeriod): string {
  return `split-stock.position-chart.${pdno}.${period}`;
}

export function readCachedCandles(pdno: string, period: ChartPeriod): Candle[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(chartCacheKey(pdno, period));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Candle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedCandles(pdno: string, period: ChartPeriod, candles: Candle[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chartCacheKey(pdno, period), JSON.stringify(candles));
  } catch {
    // ignore cache failures
  }
}

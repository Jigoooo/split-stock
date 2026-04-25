import type { LiveTick } from '@renderer/entities/realtime';
import type { Candle, ChartPeriod } from '../model/candle-types';

/** KST 기준 오늘 날짜를 YYYY-MM-DD 로 반환 */
export function todayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getPreviousDayMs(value: string): number {
  return new Date(value).getTime() - 24 * 60 * 60 * 1000;
}

export function mergeOlderCandles(
  current: Candle[],
  older: Candle[],
): { next: Candle[]; reachedEnd: boolean } {
  const seen = new Set(current.map((candle) => candle.date));
  const addedUnique = older.filter((candle) => !seen.has(candle.date));
  if (addedUnique.length === 0) {
    return { next: current, reachedEnd: true };
  }

  return {
    next: [...addedUnique, ...current].sort((left, right) => left.date.localeCompare(right.date)),
    reachedEnd: false,
  };
}

function findTodayCandle(candles: Candle[], date: string): Candle | null {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (candle?.date === date) return candle;
  }
  return null;
}

/**
 * 일봉 live candle 계산.
 * - WS tick 이 장중 OHLC를 제대로 주면 그대로 사용
 * - REST fallback quote 처럼 open/high/low 가 0이면 오늘 일봉(base)을 기준으로 보정
 * - 오늘 일봉 자체가 없으면 close=price 기준의 1점 캔들로만 생성
 */
export function buildDailyLiveCandle(
  candles: Candle[],
  tick: LiveTick | null,
  period: ChartPeriod,
): Candle | null {
  if (period !== 'D' || tick === null) return null;
  if (!Number.isFinite(tick.price) || tick.price <= 0) return null;

  const date = todayKst();
  const base = findTodayCandle(candles, date);
  const hasValidOhlc = tick.open > 0 && tick.high > 0 && tick.low > 0;

  if (hasValidOhlc) {
    return {
      date,
      open: tick.open,
      high: tick.high,
      low: tick.low,
      close: tick.price,
      volume: Math.max(tick.accumVolume, 0),
    };
  }

  if (base) {
    const open = base.open > 0 ? base.open : tick.price;
    const high = Math.max(base.high, tick.price, open);
    const low = Math.min(base.low, tick.price, open);
    return {
      date,
      open,
      high,
      low,
      close: tick.price,
      volume: Math.max(base.volume, tick.accumVolume, tick.volume, 0),
    };
  }

  return {
    date,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: Math.max(tick.accumVolume, tick.volume, 0),
  };
}

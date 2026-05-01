import { describe, expect, it } from 'vitest';
import type { DailyCandle } from '../../trading/daily-candles-repo';
import { detectSupportResistance } from './support-resistance';
import { ALGO_THRESHOLDS } from './types';

function buildRepeatedSupportCandles(
  overrides: Partial<Record<number, Partial<DailyCandle>>> = {},
) {
  const candles: DailyCandle[] = [];
  const date = new Date('2026-01-01T00:00:00Z');
  const touchIndexes = new Set([20, 45, 70]);
  for (let i = 0; i < 90; i++) {
    const wave = Math.sin(i / 5);
    let close = 112 + wave * 5;
    let high = close + 2;
    let low = close - 2;
    let volume = 200_000;
    if (touchIndexes.has(i)) {
      close = 102;
      high = 104;
      low = 100;
      volume = 320_000;
    }
    if (touchIndexes.has(i - 1) || touchIndexes.has(i - 2)) {
      high = Math.max(high, 114);
      close = Math.max(close, 112);
    }
    const candle = {
      date: date.toISOString().slice(0, 10),
      open: close,
      high,
      low,
      close,
      volume,
      ...(overrides[i] ?? {}),
    };
    candles.push(candle);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return candles;
}

describe('detectSupportResistance', () => {
  it('반복 3회 이상 touch 후 ATR 기준 반등한 level 을 strong support 로 산출한다', () => {
    const result = detectSupportResistance(buildRepeatedSupportCandles(), {
      ...ALGO_THRESHOLDS,
      srMinFrequency: 3,
    });

    const support = result.levels.find((level) => level.kind === 'support' && level.price === 100);
    expect(support).toMatchObject({
      kind: 'support',
      price: 100,
      touchCount: 3,
      invalidated: false,
    });
    expect(support?.strength).toBeGreaterThanOrEqual(65);
    expect(support?.sources).toEqual(
      expect.arrayContaining(['pivot', 'repeat-touch', 'bounce', 'volume']),
    );
    expect(result.supports).toContain(100);
  });

  it('최근 종가가 zone 하단을 2회 이상 이탈한 support 는 기본 active support 에서 제외한다', () => {
    const candles = buildRepeatedSupportCandles({
      88: { close: 95, low: 94 },
      89: { close: 94, low: 93 },
    });
    const result = detectSupportResistance(candles, {
      ...ALGO_THRESHOLDS,
      srMinFrequency: 3,
    });

    const invalidated = result.levels.find(
      (level) => level.kind === 'support' && level.price === 100,
    );
    expect(invalidated?.invalidated).toBe(true);
    expect(result.supports).not.toContain(100);
    expect(result.nearestSupport?.price).not.toBe(100);
  });

  it('단발 저점 outlier 는 support level 로 승격하지 않는다', () => {
    const candles = buildRepeatedSupportCandles({
      30: { close: 80, low: 75, high: 82, volume: 700_000 },
    });
    const result = detectSupportResistance(candles, {
      ...ALGO_THRESHOLDS,
      srMinFrequency: 3,
    });

    expect(result.levels.some((level) => level.price < 90)).toBe(false);
  });
});

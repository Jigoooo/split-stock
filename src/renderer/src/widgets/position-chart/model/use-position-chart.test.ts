import type { LiveTick } from '@renderer/entities/realtime';
import { describe, expect, it, vi } from 'vitest';
import { buildDailyLiveCandle, type Candle } from './use-position-chart';

describe('buildDailyLiveCandle', () => {
  it('REST fallback tick처럼 OHLC가 0이면 오늘 일봉 기준으로 보정한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T17:40:00+09:00'));

    const candles: Candle[] = [
      {
        date: '2026-04-22',
        open: 3000,
        high: 3100,
        low: 2900,
        close: 2950,
        volume: 10000,
      },
    ];
    const tick: LiveTick = {
      pdno: '005930',
      time: '',
      price: 2910,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 0,
      accumVolume: 0,
      open: 0,
      high: 0,
      low: 0,
      bestAsk: 0,
      bestBid: 0,
    };

    const live = buildDailyLiveCandle(candles, tick, 'D');

    expect(live).toEqual({
      date: '2026-04-22',
      open: 3000,
      high: 3100,
      low: 2900,
      close: 2910,
      volume: 10000,
    });

    vi.useRealTimers();
  });

  it('오늘 일봉이 없으면 price 기준의 1점 캔들로 만든다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T17:40:00+09:00'));

    const tick: LiveTick = {
      pdno: '005930',
      time: '',
      price: 2910,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 12,
      accumVolume: 120,
      open: 0,
      high: 0,
      low: 0,
      bestAsk: 0,
      bestBid: 0,
    };

    const live = buildDailyLiveCandle([], tick, 'D');

    expect(live).toEqual({
      date: '2026-04-22',
      open: 2910,
      high: 2910,
      low: 2910,
      close: 2910,
      volume: 120,
    });

    vi.useRealTimers();
  });
});

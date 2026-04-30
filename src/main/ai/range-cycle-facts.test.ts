import { describe, expect, it } from 'vitest';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../trading/daily-candles-repo';
import {
  buildRangeCycleFacts,
  capSymbolByDataQuality,
  classifyDataQuality,
} from './range-cycle-facts';

function createRepo(count: number): DailyCandlesRepo {
  const candles = buildCandles('2026-01-01', count);
  return {
    getInRange(_pdno: string, _period: ChartPeriod, from: string, to: string): DailyCandle[] {
      return candles.filter((c) => c.date >= from && c.date <= to);
    },
    upsertMany(): number {
      return 0;
    },
  } as unknown as DailyCandlesRepo;
}

function buildCandles(start: string, count: number): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const close = 100 + Math.sin(i / 4) * 6;
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 200_000 + i * 100,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

describe('RangeCycleFacts', () => {
  it('classifies candle coverage into blocked, limited, and normal', () => {
    expect(classifyDataQuality(29)).toBe('blocked');
    expect(classifyDataQuality(30)).toBe('limited');
    expect(classifyDataQuality(59)).toBe('limited');
    expect(classifyDataQuality(60)).toBe('normal');
  });

  it('builds shared facts with dataQuality and evidence refs', () => {
    const [facts] = buildRangeCycleFacts({
      candlesRepo: createRepo(65),
      pdnos: ['005930'],
      asOfDate: '2026-04-01',
    });
    expect(facts?.pdno).toBe('005930');
    expect(facts?.dataQuality).toBe('normal');
    expect(facts?.stat.pdno).toBe('005930');
    expect(facts?.algo.pdno).toBe('005930');
    expect(facts?.analysisConfidence).toMatch(/high|med|low/);
  });

  it('caps limited symbol recommendations and blocks blocked ones', () => {
    const limited = capSymbolByDataQuality(
      { score: 91, tier: 'top', confidence: 'high', cons: [] },
      'limited',
    );
    expect(limited).toMatchObject({ score: 60, tier: 'moderate', confidence: 'low' });

    const blocked = capSymbolByDataQuality(
      { score: 80, tier: 'strong', confidence: 'med', cons: [] },
      'blocked',
    );
    expect(blocked).toMatchObject({ score: 0, tier: 'avoid', confidence: 'low' });
  });
});

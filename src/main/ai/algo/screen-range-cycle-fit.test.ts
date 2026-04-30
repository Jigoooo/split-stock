import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../../trading/daily-candles-repo';
import { screenRangeCycleFitWithDiagnostics } from './screen-range-cycle-fit';

function createScreenDb(names: Record<string, string>, candleCount = 90): Db {
  return {
    select(fields: Record<string, unknown>) {
      const isCountQuery = Object.hasOwn(fields, 'cnt');
      return {
        from() {
          if (!isCountQuery) {
            return {
              all: () => Object.entries(names).map(([pdno, name]) => ({ pdno, name })),
            };
          }
          return {
            where: () => ({
              groupBy: () => ({
                having: () => ({
                  all: () =>
                    Object.keys(names).map((pdno) => ({
                      pdno,
                      cnt: candleCount,
                    })),
                }),
              }),
            }),
          };
        },
      };
    },
  } as unknown as Db;
}

function createRepo(byPdno: Record<string, DailyCandle[]>): DailyCandlesRepo {
  return {
    getInRange(pdno: string, _period: ChartPeriod, from: string, to: string): DailyCandle[] {
      const candles = byPdno[pdno] ?? [];
      return candles.filter((candle) => candle.date >= from && candle.date <= to);
    },
    upsertMany(): number {
      return 0;
    },
  } as unknown as DailyCandlesRepo;
}

function buildBoxRangeCandles(start: string, count: number, volume = 200_000): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const phase = (i % 20) / 20;
    const close = 110 + Math.sin(phase * Math.PI * 2) * 8 + ((i * 17) % 5) - 2;
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close - 0.5,
      high: close + 2,
      low: close - 2,
      close,
      volume,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

function buildNarrowRangeCandles(start: string, count: number, volume = 200_000): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const phase = (i % 20) / 20;
    const close = 100 + Math.sin(phase * Math.PI * 2) * 9.5;
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close - 0.3,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

function buildDownTrendCandles(start: string, count: number): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  const selloffEnd = Math.min(10, Math.floor(count / 7));
  for (let i = 0; i < count; i++) {
    let close: number;
    let high: number;
    let low: number;
    if (i === 0) {
      close = 160;
      high = 180;
      low = 158;
    } else if (i < selloffEnd) {
      close = 160 - i * 5;
      high = close + 1.2;
      low = close - 1.2;
    } else {
      const floor = 160 - selloffEnd * 5;
      close = floor - 4 - (i - selloffEnd) * 0.05;
      high = close + 0.3;
      low = close - 1.2 - (i - selloffEnd) * 0.1;
    }
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close + 0.5,
      high,
      low,
      close,
      volume: 500_000,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

describe('screenRangeCycleFitWithDiagnostics', () => {
  it('keeps a partially failed candidate and reports risk reasons instead of filtering it out', () => {
    const result = screenRangeCycleFitWithDiagnostics({
      db: createScreenDb({ '000001': '테스트저유동성' }),
      candlesRepo: createRepo({ '000001': buildBoxRangeCandles('2026-01-01', 90, 3_000) }),
      candidatePdnos: ['000001'],
      cap: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      pdno: '000001',
      name: '테스트저유동성',
      conditionPasses: expect.objectContaining({ liquidity: false }),
    });
    expect(result.candidates[0]?.riskReasons.some((reason) => reason.includes('유동성'))).toBe(
      true,
    );
    expect(result.diagnostics.evaluatedCount).toBe(1);
    expect(result.diagnostics.conditionPassCounts.liquidity).toBe(0);
    expect(result.diagnostics.lowestIncludedScore).toBe(result.candidates[0]?.score);
  });

  it('keeps liquidity 45-59 candidates instead of filtering them out', () => {
    const result = screenRangeCycleFitWithDiagnostics({
      db: createScreenDb({ '000002': '테스트중간유동성' }),
      candlesRepo: createRepo({ '000002': buildBoxRangeCandles('2026-01-01', 90, 40_000) }),
      candidatePdnos: ['000002'],
      cap: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      pdno: '000002',
      conditionPasses: expect.objectContaining({ liquidity: true }),
    });
    expect(result.candidates[0]?.riskReasons.some((reason) => reason.includes('유동성'))).toBe(
      false,
    );
    expect(result.diagnostics.conditionPassCounts.liquidity).toBe(1);
  });

  it('keeps range 55-64 candidates as moderate/watch candidates', () => {
    const result = screenRangeCycleFitWithDiagnostics({
      db: createScreenDb({ '000003': '테스트좁은박스권' }),
      candlesRepo: createRepo({ '000003': buildNarrowRangeCandles('2026-01-01', 90, 40_000) }),
      candidatePdnos: ['000003'],
      cap: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      pdno: '000003',
      conditionPasses: expect.objectContaining({ range: true }),
    });
    expect(['moderate', 'watch', 'avoid']).toContain(result.candidates[0]?.tier);
    expect(result.candidates[0]?.riskReasons.some((reason) => reason.includes('박스권'))).toBe(
      false,
    );
  });

  it('keeps strong downtrend penalties from promoting candidates to upper tiers', () => {
    const result = screenRangeCycleFitWithDiagnostics({
      db: createScreenDb({ '000004': '테스트강한하락추세' }),
      candlesRepo: createRepo({ '000004': buildDownTrendCandles('2026-01-01', 90) }),
      candidatePdnos: ['000004'],
      cap: 5,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.tier).not.toBe('top');
    expect(result.candidates[0]?.tier).not.toBe('strong');
  });

  it('blocks only candidates whose signals cannot be computed', () => {
    const result = screenRangeCycleFitWithDiagnostics({
      db: createScreenDb({ '000001': '데이터부족' }),
      candlesRepo: createRepo({ '000001': buildBoxRangeCandles('2026-01-01', 10) }),
      candidatePdnos: ['000001'],
      cap: 5,
      minCandles: 1,
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.evaluatedCount).toBe(1);
    expect(result.diagnostics.blockedCount).toBe(1);
    expect(result.diagnostics.lowestIncludedScore).toBeNull();
  });
});

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

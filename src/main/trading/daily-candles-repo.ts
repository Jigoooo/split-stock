import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dailyCandles } from '../db/schema';

export type ChartPeriod = 'D' | 'W' | 'M';

export interface DailyCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 일/주/월봉 로컬 캐시 리포.
 * (pdno, period, date) 단위로 저장. upsertMany는 중복 시 최신 값으로 덮어씀.
 */
export class DailyCandlesRepo {
  constructor(private readonly db: Db) {}

  /**
   * from..to (inclusive, YYYY-MM-DD) 범위 내 캐시된 봉을 오래된 순으로 반환.
   */
  getInRange(pdno: string, period: ChartPeriod, from: string, to: string): DailyCandle[] {
    const rows = this.db
      .select()
      .from(dailyCandles)
      .where(
        and(
          eq(dailyCandles.pdno, pdno),
          eq(dailyCandles.period, period),
          gte(dailyCandles.date, from),
          lte(dailyCandles.date, to),
        ),
      )
      .orderBy(asc(dailyCandles.date))
      .all();
    return rows.map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  /** 캐시 저장 — 중복 date는 최신 fetchedAt으로 덮어씀 (부분 체결된 최근 봉 갱신 대응). */
  upsertMany(pdno: string, period: ChartPeriod, candles: DailyCandle[]): number {
    if (candles.length === 0) return 0;
    const now = new Date();
    let count = 0;
    this.db.transaction((tx) => {
      for (const c of candles) {
        const existing = tx
          .select({ date: dailyCandles.date })
          .from(dailyCandles)
          .where(
            and(
              eq(dailyCandles.pdno, pdno),
              eq(dailyCandles.period, period),
              eq(dailyCandles.date, c.date),
            ),
          )
          .all();
        if (existing.length > 0) {
          tx.update(dailyCandles)
            .set({
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              fetchedAt: now,
            })
            .where(
              and(
                eq(dailyCandles.pdno, pdno),
                eq(dailyCandles.period, period),
                eq(dailyCandles.date, c.date),
              ),
            )
            .run();
        } else {
          tx.insert(dailyCandles)
            .values({
              pdno,
              period,
              date: c.date,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              fetchedAt: now,
            })
            .run();
        }
        count += 1;
      }
    });
    return count;
  }
}

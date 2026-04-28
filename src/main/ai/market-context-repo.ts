import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ecosSeriesCache, krxBaseInfoCache, krxDailyTradeCache } from '../db/schema';
import type { EcosSeriesPoint } from './ecos-client';
import type { KrxBaseInfoRow, KrxDailyTradeRow, KrxMarket } from './krx-client';

export interface CachedKrxDailyTrade extends KrxDailyTradeRow {
  fetchedAt: Date;
}

export interface CachedEcosSeriesPoint extends EcosSeriesPoint {
  fetchedAt: Date;
}

export class MarketContextRepo {
  constructor(private readonly db: Db) {}

  upsertKrxDailyTrade(rows: ReadonlyArray<KrxDailyTradeRow>, fetchedAt = new Date()): number {
    let count = 0;
    this.db.transaction((tx) => {
      for (const row of rows) {
        const existing = tx
          .select({ pdno: krxDailyTradeCache.pdno })
          .from(krxDailyTradeCache)
          .where(
            and(
              eq(krxDailyTradeCache.market, row.market),
              eq(krxDailyTradeCache.pdno, row.pdno),
              eq(krxDailyTradeCache.date, row.date),
            ),
          )
          .get();
        const value = { ...row, fetchedAt };
        if (existing) {
          tx.update(krxDailyTradeCache)
            .set(value)
            .where(
              and(
                eq(krxDailyTradeCache.market, row.market),
                eq(krxDailyTradeCache.pdno, row.pdno),
                eq(krxDailyTradeCache.date, row.date),
              ),
            )
            .run();
        } else {
          tx.insert(krxDailyTradeCache).values(value).run();
        }
        count += 1;
      }
    });
    return count;
  }

  upsertKrxBaseInfo(rows: ReadonlyArray<KrxBaseInfoRow>, fetchedAt = new Date()): number {
    let count = 0;
    this.db.transaction((tx) => {
      for (const row of rows) {
        const existing = tx
          .select({ pdno: krxBaseInfoCache.pdno })
          .from(krxBaseInfoCache)
          .where(
            and(
              eq(krxBaseInfoCache.market, row.market),
              eq(krxBaseInfoCache.pdno, row.pdno),
              eq(krxBaseInfoCache.date, row.date),
            ),
          )
          .get();
        const value = { ...row, fetchedAt };
        if (existing) {
          tx.update(krxBaseInfoCache)
            .set(value)
            .where(
              and(
                eq(krxBaseInfoCache.market, row.market),
                eq(krxBaseInfoCache.pdno, row.pdno),
                eq(krxBaseInfoCache.date, row.date),
              ),
            )
            .run();
        } else {
          tx.insert(krxBaseInfoCache).values(value).run();
        }
        count += 1;
      }
    });
    return count;
  }

  upsertEcosSeries(rows: ReadonlyArray<EcosSeriesPoint>, fetchedAt = new Date()): number {
    let count = 0;
    this.db.transaction((tx) => {
      for (const row of rows) {
        const existing = tx
          .select({ indicator: ecosSeriesCache.indicator })
          .from(ecosSeriesCache)
          .where(
            and(eq(ecosSeriesCache.indicator, row.indicator), eq(ecosSeriesCache.date, row.date)),
          )
          .get();
        const value = { ...row, fetchedAt };
        if (existing) {
          tx.update(ecosSeriesCache)
            .set(value)
            .where(
              and(eq(ecosSeriesCache.indicator, row.indicator), eq(ecosSeriesCache.date, row.date)),
            )
            .run();
        } else {
          tx.insert(ecosSeriesCache).values(value).run();
        }
        count += 1;
      }
    });
    return count;
  }

  getLatestKrxDailyTrade(pdnos: ReadonlyArray<string>): Map<string, CachedKrxDailyTrade> {
    if (pdnos.length === 0) return new Map();
    const rows = this.db
      .select()
      .from(krxDailyTradeCache)
      .where(
        inArray(
          krxDailyTradeCache.pdno,
          pdnos.map((p) => p.padStart(6, '0')),
        ),
      )
      .orderBy(desc(krxDailyTradeCache.date))
      .all();
    const out = new Map<string, CachedKrxDailyTrade>();
    for (const row of rows) {
      if (out.has(row.pdno)) continue;
      out.set(row.pdno, {
        market: row.market as KrxMarket,
        date: row.date,
        pdno: row.pdno,
        name: row.name,
        close: row.close ?? null,
        change: row.change ?? null,
        changeRate: row.changeRate ?? null,
        open: row.open ?? null,
        high: row.high ?? null,
        low: row.low ?? null,
        volume: row.volume ?? null,
        tradeValue: row.tradeValue ?? null,
        marketCap: row.marketCap ?? null,
        listedShares: row.listedShares ?? null,
        fetchedAt: row.fetchedAt,
      });
    }
    return out;
  }

  getLatestEcosPoints(): CachedEcosSeriesPoint[] {
    const rows = this.db.select().from(ecosSeriesCache).orderBy(desc(ecosSeriesCache.date)).all();
    const seen = new Set<string>();
    const out: CachedEcosSeriesPoint[] = [];
    for (const row of rows) {
      if (seen.has(row.indicator)) continue;
      seen.add(row.indicator);
      out.push({
        indicator: row.indicator,
        statCode: row.statCode,
        itemCode: row.itemCode,
        frequency: row.frequency as EcosSeriesPoint['frequency'],
        date: row.date,
        value: row.value,
        unitName: row.unitName ?? null,
        fetchedAt: row.fetchedAt,
      });
    }
    return out;
  }
}

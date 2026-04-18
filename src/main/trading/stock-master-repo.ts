import { asc, eq, like, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { stockMaster } from '../db/schema';

export interface StockEntry {
  pdno: string;
  name: string;
  sector: string | null;
  updatedAt: Date;
}

export interface UpsertStockInput {
  pdno: string;
  name: string;
  sector?: string | null;
}

export class StockMasterRepo {
  constructor(private readonly db: Db) {}

  find(pdno: string): StockEntry | null {
    const rows = this.db.select().from(stockMaster).where(eq(stockMaster.pdno, pdno)).all();
    const row = rows[0];
    if (!row) return null;
    return {
      pdno: row.pdno,
      name: row.name,
      sector: row.sector,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * 한글명(부분일치) + 종목코드(전/부분일치) 통합 검색.
   * limit로 prefix 매칭 우선 노출은 호출측이 정렬/순위 지정.
   */
  search(keyword: string, limit = 20): StockEntry[] {
    const trimmed = keyword.trim();
    if (!trimmed) return [];
    const pattern = `%${trimmed}%`;
    const rows = this.db
      .select()
      .from(stockMaster)
      .where(or(like(stockMaster.name, pattern), like(stockMaster.pdno, pattern)))
      .orderBy(asc(stockMaster.name))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      pdno: r.pdno,
      name: r.name,
      sector: r.sector,
      updatedAt: r.updatedAt,
    }));
  }

  upsertMany(entries: UpsertStockInput[]): number {
    if (entries.length === 0) return 0;
    const now = new Date();
    let count = 0;
    this.db.transaction((tx) => {
      for (const e of entries) {
        const existing = tx
          .select({ pdno: stockMaster.pdno })
          .from(stockMaster)
          .where(eq(stockMaster.pdno, e.pdno))
          .all();
        if (existing.length > 0) {
          tx.update(stockMaster)
            .set({ name: e.name, sector: e.sector ?? null, updatedAt: now })
            .where(eq(stockMaster.pdno, e.pdno))
            .run();
        } else {
          tx.insert(stockMaster)
            .values({ pdno: e.pdno, name: e.name, sector: e.sector ?? null, updatedAt: now })
            .run();
        }
        count += 1;
      }
    });
    return count;
  }
}

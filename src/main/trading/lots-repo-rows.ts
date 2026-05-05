import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots as lotsTable } from '../db/schema';
import type { LotStatus } from './fsm';
import type { LotRow } from './lots-repo-types';
import type { StockMasterRepo } from './stock-master-repo';

export type LotsTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** 단일 행 → LotRow 변환. boughtAt/soldAt은 ms 로 정규화. */
export function toLotRow(r: typeof lotsTable.$inferSelect): LotRow {
  return {
    id: r.id,
    accountId: r.accountId,
    pdno: r.pdno,
    nth: r.nth,
    buyPrice: r.buyPrice,
    qty: r.qty,
    amountKrw: r.amountKrw,
    status: r.status as LotStatus,
    boughtAt: r.boughtAt instanceof Date ? r.boughtAt.getTime() : Number(r.boughtAt),
    soldAt:
      r.soldAt === null ? null : r.soldAt instanceof Date ? r.soldAt.getTime() : Number(r.soldAt),
    sellPrice: r.sellPrice ?? null,
  };
}

/** (accountId, pdno) 기준 전체 차수 스냅샷 — undo 복원 baseline. */
export function snapshotRowsTx(
  tx: LotsTransaction,
  accountId: number,
  pdno: string,
  broker: string = 'KIS',
): LotRow[] {
  const rows = tx
    .select()
    .from(lotsTable)
    .where(
      and(
        eq(lotsTable.broker, broker),
        eq(lotsTable.accountId, accountId),
        eq(lotsTable.pdno, pdno),
      ),
    )
    .all();
  return rows.map((r) => toLotRow(r));
}

export function createNameResolver(stockMasterRepo?: StockMasterRepo): (pdno: string) => string {
  const nameCache = new Map<string, string>();
  return (pdno: string): string => {
    const cached = nameCache.get(pdno);
    if (cached !== undefined) return cached;
    const found = stockMasterRepo?.find(pdno)?.name ?? '';
    nameCache.set(pdno, found);
    return found;
  };
}

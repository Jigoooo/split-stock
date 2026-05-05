import { and, asc, eq, inArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lots as lotsTable } from '../db/schema';
import type { LotStatus } from './fsm';
import type { LotsRepoError } from './lots-repo-errors';
import { createNameResolver, toLotRow } from './lots-repo-rows';
import type {
  CyclesByPdnoInput,
  LotRow,
  TradeCycle,
  TradeHistoryFilters,
  TradeHistoryLot,
} from './lots-repo-types';
import type { StockMasterRepo } from './stock-master-repo';

/**
 * (accountId, pdno) 의 현재 OPEN 상태 차수 목록 — working view 용.
 *
 * snapshot 과 달리 실제 lots 테이블에서 직접 조회하므로 lotId 포함.
 * EditLotsGrid 같은 행 단위 mutation UI 의 데이터 소스로 사용.
 * lotId 정합성 보장 — 행 액션이 정확한 row 를 변경.
 */
export function listOpenLots(
  db: Db,
  accountId: number,
  pdno: string,
  broker: string = 'KIS',
): Result<LotRow[], LotsRepoError> {
  try {
    const rows = db
      .select()
      .from(lotsTable)
      .where(
        and(
          eq(lotsTable.broker, broker),
          eq(lotsTable.accountId, accountId),
          eq(lotsTable.pdno, pdno),
          eq(lotsTable.status, 'OPEN'),
        ),
      )
      .orderBy(asc(lotsTable.nth))
      .all();
    return ok(rows.map((r) => toLotRow(r)));
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

/**
 * 매매 사이클 조회 — 종목별 차수의 매수→매도 라이프사이클 요약.
 *
 * - per-account 격리: accountId 강제.
 * - pdno 옵션: 미지정 시 모든 종목, 지정 시 해당 종목만.
 * - status 필터: 'all' | 'open'(OPEN|BUYING) | 'closed'(SOLD).
 *   주의: SELLING 상태(매도 진행 중)는 'open'/'closed' 어디에도 포함하지 않는다 — 'all' 로만 노출.
 * - 종목명(name): stockMasterRepo로 lookup, 미주입 또는 미발견 시 빈 문자열.
 *   (lots 테이블에 name 컬럼이 없어 외부 lookup 필요. 호출당 종목별 1회 캐싱)
 * - pnl: SOLD 차수에 한해 sellPrice*qty - amountKrw, pnlRate = (pnl/amountKrw)*100 (백분율).
 */
export function cyclesByPdno(
  db: Db,
  stockMasterRepo: StockMasterRepo | undefined,
  input: CyclesByPdnoInput,
  broker: string = 'KIS',
): Result<TradeCycle[], LotsRepoError> {
  try {
    const conditions = [eq(lotsTable.broker, broker), eq(lotsTable.accountId, input.accountId)];
    if (input.pdno !== undefined) {
      conditions.push(eq(lotsTable.pdno, input.pdno));
    }
    if (input.status === 'open') {
      conditions.push(inArray(lotsTable.status, ['OPEN', 'BUYING']));
    } else if (input.status === 'closed') {
      conditions.push(eq(lotsTable.status, 'SOLD'));
    }
    // 'all' 은 status 조건 없음
    const rows = db
      .select()
      .from(lotsTable)
      .where(and(...conditions))
      .orderBy(asc(lotsTable.pdno), asc(lotsTable.nth))
      .all();
    const resolveName = createNameResolver(stockMasterRepo);
    const cycles: TradeCycle[] = rows.map((r) => {
      const status = r.status as LotStatus;
      const sellPrice = r.sellPrice ?? undefined;
      const soldAtMs =
        r.soldAt === null
          ? undefined
          : r.soldAt instanceof Date
            ? r.soldAt.getTime()
            : Number(r.soldAt);
      const boughtAtMs = r.boughtAt instanceof Date ? r.boughtAt.getTime() : Number(r.boughtAt);
      const cycle: TradeCycle = {
        id: r.id,
        nth: r.nth,
        pdno: r.pdno,
        name: resolveName(r.pdno),
        buyPrice: r.buyPrice,
        qty: r.qty,
        amountKrw: r.amountKrw,
        status,
        boughtAt: boughtAtMs,
      };
      if (soldAtMs !== undefined) cycle.soldAt = soldAtMs;
      if (sellPrice !== undefined) cycle.sellPrice = sellPrice;
      if (status === 'SOLD' && sellPrice !== undefined && r.amountKrw > 0) {
        const pnl = sellPrice * r.qty - r.amountKrw;
        cycle.pnl = pnl;
        cycle.pnlRate = (pnl / r.amountKrw) * 100;
      }
      return cycle;
    });
    return ok(cycles);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

/**
 * 모든 매매 내역 전용 lot 목록 조회.
 *
 * v1은 account 단위로 lot을 읽은 뒤 JS 레벨에서 relevantAt / 이름 검색을 적용한다.
 * 종목명은 stockMasterRepo lookup, 미주입 또는 미발견 시 빈 문자열.
 */
export function listTradeHistoryLots(
  db: Db,
  stockMasterRepo: StockMasterRepo | undefined,
  input: TradeHistoryFilters,
  broker: string = 'KIS',
): Result<TradeHistoryLot[], LotsRepoError> {
  try {
    const rows = db
      .select()
      .from(lotsTable)
      .where(and(eq(lotsTable.broker, broker), eq(lotsTable.accountId, input.accountId)))
      .all();
    const trimmedSearch = input.search?.trim() ?? '';
    const normalizedSearch = trimmedSearch.toLowerCase();
    const resolveName = createNameResolver(stockMasterRepo);
    const lots: TradeHistoryLot[] = [];
    for (const row of rows) {
      const soldAtMs =
        row.soldAt === null
          ? undefined
          : row.soldAt instanceof Date
            ? row.soldAt.getTime()
            : Number(row.soldAt);
      const boughtAtMs =
        row.boughtAt instanceof Date ? row.boughtAt.getTime() : Number(row.boughtAt);
      const relevantAt = soldAtMs ?? boughtAtMs;
      const relevantDate = new Date(relevantAt);
      const year = relevantDate.getUTCFullYear();
      const month = relevantDate.getUTCMonth() + 1;
      const day = relevantDate.getUTCDate();
      if (year !== input.year || month !== input.month) continue;
      if (input.day !== undefined && day !== input.day) continue;

      const name = resolveName(row.pdno);
      if (
        normalizedSearch !== '' &&
        !row.pdno.includes(trimmedSearch) &&
        !name.toLowerCase().includes(normalizedSearch)
      ) {
        continue;
      }

      const entry: TradeHistoryLot = {
        id: row.id,
        pdno: row.pdno,
        name,
        nth: row.nth,
        qty: row.qty,
        amountKrw: row.amountKrw,
        status: row.status as LotStatus,
        buyPrice: row.buyPrice,
        boughtAt: boughtAtMs,
      };
      if (soldAtMs !== undefined) entry.soldAt = soldAtMs;
      if (row.sellPrice !== null) entry.sellPrice = row.sellPrice;
      lots.push(entry);
    }

    lots.sort((a, b) => {
      const relevantA = a.soldAt ?? a.boughtAt;
      const relevantB = b.soldAt ?? b.boughtAt;
      if (relevantB !== relevantA) return relevantB - relevantA;
      if (a.pdno !== b.pdno) return a.pdno.localeCompare(b.pdno);
      return a.nth - b.nth;
    });

    return ok(lots);
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

/** lots 의 raw 행 조회 — manual 라우터가 평가/미리보기에 사용. */
export function listRows(
  db: Db,
  accountId: number,
  pdno?: string,
  broker: string = 'KIS',
): Result<LotRow[], LotsRepoError> {
  try {
    const conditions = [eq(lotsTable.broker, broker), eq(lotsTable.accountId, accountId)];
    if (pdno !== undefined) conditions.push(eq(lotsTable.pdno, pdno));
    const rows = db
      .select()
      .from(lotsTable)
      .where(and(...conditions))
      .orderBy(asc(lotsTable.pdno), asc(lotsTable.nth))
      .all();
    return ok(rows.map((r) => toLotRow(r)));
  } catch (cause) {
    return err({ kind: 'DB_ERROR', cause });
  }
}

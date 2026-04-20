import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lotsSnapshots, lots as lotsTable } from '../db/schema';
import type { LotStatus, PositionSnapshot } from './fsm';
import type { RespiitPlan } from './respiit-planner';
import type { StockMasterRepo } from './stock-master-repo';

/** lots_snapshots 테이블에 저장되는 차수 항목 */
export interface LotSnapshotEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms timestamp
  soldAt?: number;
  sellPrice?: number;
}

/** snapshotByDate() 반환 타입 */
export interface LotsSnapshot {
  pdno: string;
  name: string;
  currentPrice: number;
  snapshotDate: string;
  lots: LotSnapshotEntry[];
}

/** saveSnapshot() 입력 */
export interface SaveSnapshotInput {
  accountId: number;
  snapshotDate: string; // YYYY-MM-DD
  pdno: string;
  name: string;
  currentPrice: number;
  lots: LotSnapshotEntry[];
}

export type LotsRepoError =
  | { kind: 'DB_ERROR'; cause: unknown }
  | { kind: 'NOT_FOUND'; lotId: number }
  | { kind: 'CONFLICT'; reason: string }
  | { kind: 'NO_HISTORY'; reason: string };

/** LotsRepoError 의 사람이 읽을 수 있는 메시지 — 라우터/로거 공용. */
export function lotsRepoErrorMessage(e: LotsRepoError): string {
  switch (e.kind) {
    case 'DB_ERROR':
      return String(e.cause ?? 'unknown DB error');
    case 'NOT_FOUND':
      return `lot 없음 (id=${e.lotId})`;
    case 'CONFLICT':
      return e.reason;
    case 'NO_HISTORY':
      return e.reason;
  }
}

/** 수동편집 트랜잭션의 before/after 스냅샷 — undo 및 audit 용. */
export interface LotRow {
  id: number;
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms timestamp
  soldAt: number | null;
  sellPrice: number | null;
}

/** manual* 메서드 결과 — audit_payload 에 기록할 before/after diff */
export interface ManualEditResult {
  before: LotRow | null;
  after: LotRow | null;
  /** 적용 이전 (계좌, 종목)의 모든 OPEN 차수 — undo 시 복원 기준 스냅샷 */
  fullSnapshot: LotRow[];
}

export interface ManualInsertInput {
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: Date;
}

export interface ManualUpdateChanges {
  buyPrice?: number;
  qty?: number;
  amountKrw?: number;
  status?: LotStatus;
  boughtAt?: Date;
  soldAt?: Date | null;
  sellPrice?: number | null;
  nth?: number;
}

export interface InsertLotInput {
  accountId: number;
  pdno: string;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: Date;
}

export interface UpdateLotStatusInput {
  lotId: number;
  status: LotStatus;
  sellPrice?: number;
  soldAt?: Date;
}

/**
 * cyclesByPdno() 반환 항목 — 한 차수의 매매 사이클(매수→매도) 요약.
 *
 * status 매핑:
 *   - 'all'    : 모든 lots (OPEN/BUYING/SELLING/SOLD)
 *   - 'open'   : OPEN | BUYING (보유 중 — 미매도)
 *   - 'closed' : SOLD (매도 완료)
 *   주의: SELLING(매도 진행 중)은 'open'/'closed' 어디에도 안 들어간다 — 'all'로만 노출.
 *
 * 단위:
 *   - pnl: 원(KRW)
 *   - pnlRate: 백분율 표현 (예: 5.25 == 5.25%) — KIS Position.pnlRate 관례와 일치.
 */
export interface TradeCycle {
  id: number;
  nth: number;
  pdno: string;
  name: string;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: LotStatus;
  boughtAt: number; // ms epoch
  soldAt?: number;
  sellPrice?: number;
  pnl?: number; // 원 (sellPrice * qty - amountKrw)
  pnlRate?: number; // 백분율 — (pnl / amountKrw) * 100
}

export type CycleStatusFilter = 'all' | 'open' | 'closed';

export interface CyclesByPdnoInput {
  accountId: number;
  pdno?: string;
  status: CycleStatusFilter;
}

/**
 * 차수 장부 레포지토리.
 * 중요: better-sqlite3 transaction으로 insert/update가 원자적으로 실행됨.
 * 콜백이 throw하면 자동 rollback.
 */
export class LotsRepo {
  constructor(
    private readonly db: Db,
    private readonly stockMasterRepo?: StockMasterRepo,
  ) {}

  snapshot(accountId: number, pdno: string): Result<PositionSnapshot, LotsRepoError> {
    try {
      const rows = this.db
        .select()
        .from(lotsTable)
        .where(and(eq(lotsTable.accountId, accountId), eq(lotsTable.pdno, pdno)))
        .all();
      return ok({
        pdno,
        lots: rows.map((r) => ({
          nth: r.nth,
          buyPrice: r.buyPrice,
          qty: r.qty,
          status: r.status as LotStatus,
        })),
      });
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 원자적 insert — 이미 존재하는 (accountId, pdno, nth) 차수는 거부.
   * 동시성 안전: transaction으로 select-then-insert 사이 경합 차단.
   */
  insertLot(input: InsertLotInput): Result<number, LotsRepoError> {
    try {
      const id = this.db.transaction((tx) => {
        const existing = tx
          .select({ id: lotsTable.id })
          .from(lotsTable)
          .where(
            and(
              eq(lotsTable.accountId, input.accountId),
              eq(lotsTable.pdno, input.pdno),
              eq(lotsTable.nth, input.nth),
            ),
          )
          .all();
        if (existing.length > 0) {
          throw new Error(
            `duplicate lot: account=${input.accountId} pdno=${input.pdno} nth=${input.nth}`,
          );
        }
        const inserted = tx
          .insert(lotsTable)
          .values({
            accountId: input.accountId,
            pdno: input.pdno,
            nth: input.nth,
            buyPrice: input.buyPrice,
            qty: input.qty,
            amountKrw: input.amountKrw,
            status: input.status,
            boughtAt: input.boughtAt,
          })
          .returning({ id: lotsTable.id })
          .all();
        const row = inserted[0];
        if (!row) throw new Error('insert returned no row');
        return row.id;
      });
      return ok(id);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 리스플리트(재편성) — 기존 OPEN 차수를 삭제하고 새 plan으로 교체.
   * SOLD/BUYING/SELLING 상태 차수는 보존 (확정된 과거 기록).
   * 전체 트랜잭션 — 중간 실패 시 완전 rollback.
   */
  replan(accountId: number, plan: RespiitPlan): Result<{ insertedIds: number[] }, LotsRepoError> {
    try {
      const insertedIds = this.db.transaction((tx) => {
        // OPEN 차수만 제거. SOLD/BUYING/SELLING은 감사 기록으로 보존.
        tx.delete(lotsTable)
          .where(
            and(
              eq(lotsTable.accountId, accountId),
              eq(lotsTable.pdno, plan.pdno),
              eq(lotsTable.status, 'OPEN'),
            ),
          )
          .run();
        // 보존된 차수와 nth가 겹치는지 검증 — 겹치면 full rollback
        const preserved = tx
          .select({ nth: lotsTable.nth })
          .from(lotsTable)
          .where(
            and(
              eq(lotsTable.accountId, accountId),
              eq(lotsTable.pdno, plan.pdno),
              ne(lotsTable.status, 'OPEN'),
            ),
          )
          .all();
        const preservedNths = new Set(preserved.map((r) => r.nth));
        for (const e of plan.entries) {
          if (preservedNths.has(e.nth)) {
            throw new Error(
              `replan nth 충돌: account=${accountId} pdno=${plan.pdno} nth=${e.nth}은 보존된 차수와 겹칩니다`,
            );
          }
        }
        const ids: number[] = [];
        for (const e of plan.entries) {
          const inserted = tx
            .insert(lotsTable)
            .values({
              accountId,
              pdno: plan.pdno,
              nth: e.nth,
              buyPrice: e.buyPrice,
              qty: e.qty,
              amountKrw: e.amountKrw,
              status: 'OPEN' as LotStatus,
              boughtAt: e.boughtAt,
            })
            .returning({ id: lotsTable.id })
            .all();
          const row = inserted[0];
          if (!row) throw new Error('replan insert returned no row');
          ids.push(row.id);
        }
        return ids;
      });
      return ok({ insertedIds });
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 특정 일자의 모든 종목 차수 스냅샷 조회.
   * pdno를 지정하면 해당 종목만 반환.
   */
  snapshotByDate(
    accountId: number,
    snapshotDate: string,
    pdno?: string,
  ): Result<LotsSnapshot[], LotsRepoError> {
    try {
      const conditions = [
        eq(lotsSnapshots.accountId, accountId),
        eq(lotsSnapshots.snapshotDate, snapshotDate),
      ];
      if (pdno !== undefined) {
        conditions.push(eq(lotsSnapshots.pdno, pdno));
      }
      const rows = this.db
        .select()
        .from(lotsSnapshots)
        .where(and(...conditions))
        .orderBy(asc(lotsSnapshots.pdno))
        .all();
      const result: LotsSnapshot[] = rows.map((r) => ({
        pdno: r.pdno,
        name: r.name,
        currentPrice: r.currentPrice,
        snapshotDate: r.snapshotDate,
        lots: JSON.parse(r.payloadJson) as LotSnapshotEntry[],
      }));
      return ok(result);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 스냅샷이 존재하는 날짜 목록 조회 (최신순).
   */
  listSnapshotDates(accountId: number): Result<string[], LotsRepoError> {
    try {
      const rows = this.db
        .selectDistinct({ snapshotDate: lotsSnapshots.snapshotDate })
        .from(lotsSnapshots)
        .where(eq(lotsSnapshots.accountId, accountId))
        .orderBy(desc(lotsSnapshots.snapshotDate))
        .all();
      return ok(rows.map((r) => r.snapshotDate));
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 차수 스냅샷 저장 (upsert — 같은 날짜/종목이면 덮어씀).
   * 장마감 스케줄러 또는 수동 트리거에서 호출.
   */
  saveSnapshot(input: SaveSnapshotInput): Result<void, LotsRepoError> {
    try {
      const now = new Date();
      this.db
        .insert(lotsSnapshots)
        .values({
          accountId: input.accountId,
          snapshotDate: input.snapshotDate,
          pdno: input.pdno,
          name: input.name,
          currentPrice: input.currentPrice,
          payloadJson: JSON.stringify(input.lots),
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [lotsSnapshots.accountId, lotsSnapshots.snapshotDate, lotsSnapshots.pdno],
          set: {
            name: input.name,
            currentPrice: input.currentPrice,
            payloadJson: JSON.stringify(input.lots),
            createdAt: now,
          },
        })
        .run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  updateLotStatus(input: UpdateLotStatusInput): Result<void, LotsRepoError> {
    try {
      this.db.transaction((tx) => {
        const updates: Partial<typeof lotsTable.$inferInsert> = { status: input.status };
        if (input.sellPrice !== undefined) updates.sellPrice = input.sellPrice;
        if (input.soldAt !== undefined) updates.soldAt = input.soldAt;
        const res = tx.update(lotsTable).set(updates).where(eq(lotsTable.id, input.lotId)).run();
        if (res.changes === 0) {
          throw new Error(`lot not found: id=${input.lotId}`);
        }
      });
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  // ==========================================================================
  // 수동편집(A7) — 차수 직접 추가/수정/삭제/이동, 액면분할 일괄 보정
  //
  // 안전 불변식:
  //  - per-account 격리: 모든 메서드는 accountId 강제 매개변수.
  //  - 자동매매 OFF 강제는 호출측(tRPC 라우터) 책임. repo 는 순수 DB 트랜잭션 레이어.
  //  - 모든 변경은 단일 트랜잭션 — 중간 실패 시 완전 rollback.
  //  - before/after 스냅샷은 ManualEditResult 로 반환 → 호출측이 audit_payload 기록.
  // ==========================================================================

  /** 단일 행 → LotRow 변환. boughtAt/soldAt은 ms 로 정규화. */
  private toLotRow(r: typeof lotsTable.$inferSelect): LotRow {
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
  private snapshotRowsTx(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    accountId: number,
    pdno: string,
  ): LotRow[] {
    const rows = tx
      .select()
      .from(lotsTable)
      .where(and(eq(lotsTable.accountId, accountId), eq(lotsTable.pdno, pdno)))
      .all();
    return rows.map((r) => this.toLotRow(r));
  }

  /**
   * 수동 차수 직접 삽입.
   * - 동일 (accountId, pdno, nth) 존재 시 CONFLICT.
   * - 자동매매 ON 차단은 라우터 레이어 책임.
   */
  manualInsert(input: ManualInsertInput): Result<ManualEditResult, LotsRepoError> {
    try {
      const result = this.db.transaction((tx) => {
        const fullSnapshot = this.snapshotRowsTx(tx, input.accountId, input.pdno);
        const existing = tx
          .select({ id: lotsTable.id })
          .from(lotsTable)
          .where(
            and(
              eq(lotsTable.accountId, input.accountId),
              eq(lotsTable.pdno, input.pdno),
              eq(lotsTable.nth, input.nth),
            ),
          )
          .all();
        if (existing.length > 0) {
          throw new Error(
            `CONFLICT: 동일 차수 존재 (account=${input.accountId} pdno=${input.pdno} nth=${input.nth})`,
          );
        }
        const inserted = tx
          .insert(lotsTable)
          .values({
            accountId: input.accountId,
            pdno: input.pdno,
            nth: input.nth,
            buyPrice: input.buyPrice,
            qty: input.qty,
            amountKrw: input.amountKrw,
            status: input.status,
            boughtAt: input.boughtAt,
          })
          .returning()
          .all();
        const row = inserted[0];
        if (!row) throw new Error('manualInsert: insert returned no row');
        return {
          before: null,
          after: this.toLotRow(row),
          fullSnapshot,
        } satisfies ManualEditResult;
      });
      return ok(result);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('CONFLICT:')) return err({ kind: 'CONFLICT', reason: msg });
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 수동 차수 수정 — buyPrice/qty/amountKrw/status/boughtAt/soldAt/sellPrice/nth 변경.
   * - per-account 격리: accountId 검증.
   * - 없는 lot → NOT_FOUND.
   * - nth 변경 시 동일 (account, pdno) 안에 충돌 검사.
   */
  manualUpdate(
    accountId: number,
    lotId: number,
    changes: ManualUpdateChanges,
  ): Result<ManualEditResult, LotsRepoError> {
    try {
      const result = this.db.transaction((tx) => {
        const rows = tx
          .select()
          .from(lotsTable)
          .where(and(eq(lotsTable.id, lotId), eq(lotsTable.accountId, accountId)))
          .all();
        const target = rows[0];
        if (!target) throw new Error(`NOT_FOUND: lot id=${lotId} (account=${accountId})`);
        const fullSnapshot = this.snapshotRowsTx(tx, accountId, target.pdno);
        const before = this.toLotRow(target);
        // nth 변경 시 충돌 검사
        if (changes.nth !== undefined && changes.nth !== target.nth) {
          const conflict = tx
            .select({ id: lotsTable.id })
            .from(lotsTable)
            .where(
              and(
                eq(lotsTable.accountId, accountId),
                eq(lotsTable.pdno, target.pdno),
                eq(lotsTable.nth, changes.nth),
              ),
            )
            .all();
          if (conflict.length > 0) {
            throw new Error(
              `CONFLICT: 차수 변경 충돌 (account=${accountId} pdno=${target.pdno} nth=${changes.nth} 이미 존재)`,
            );
          }
        }
        const updates: Partial<typeof lotsTable.$inferInsert> = {};
        if (changes.buyPrice !== undefined) updates.buyPrice = changes.buyPrice;
        if (changes.qty !== undefined) updates.qty = changes.qty;
        if (changes.amountKrw !== undefined) updates.amountKrw = changes.amountKrw;
        if (changes.status !== undefined) updates.status = changes.status;
        if (changes.boughtAt !== undefined) updates.boughtAt = changes.boughtAt;
        if (changes.soldAt !== undefined) updates.soldAt = changes.soldAt;
        if (changes.sellPrice !== undefined) updates.sellPrice = changes.sellPrice;
        if (changes.nth !== undefined) updates.nth = changes.nth;
        if (Object.keys(updates).length > 0) {
          tx.update(lotsTable).set(updates).where(eq(lotsTable.id, lotId)).run();
        }
        const updatedRows = tx.select().from(lotsTable).where(eq(lotsTable.id, lotId)).all();
        const updated = updatedRows[0];
        if (!updated) throw new Error('manualUpdate: row vanished after update');
        return {
          before,
          after: this.toLotRow(updated),
          fullSnapshot,
        } satisfies ManualEditResult;
      });
      return ok(result);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('NOT_FOUND:')) return err({ kind: 'NOT_FOUND', lotId });
      if (msg.startsWith('CONFLICT:')) return err({ kind: 'CONFLICT', reason: msg });
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 수동 차수 삭제 — KIS 잔고와 불일치할 수 있음.
   * 호출측에서 명확히 경고를 표시할 책임.
   */
  manualDelete(accountId: number, lotId: number): Result<ManualEditResult, LotsRepoError> {
    try {
      const result = this.db.transaction((tx) => {
        const rows = tx
          .select()
          .from(lotsTable)
          .where(and(eq(lotsTable.id, lotId), eq(lotsTable.accountId, accountId)))
          .all();
        const target = rows[0];
        if (!target) throw new Error(`NOT_FOUND: lot id=${lotId} (account=${accountId})`);
        const fullSnapshot = this.snapshotRowsTx(tx, accountId, target.pdno);
        const before = this.toLotRow(target);
        tx.delete(lotsTable).where(eq(lotsTable.id, lotId)).run();
        return {
          before,
          after: null,
          fullSnapshot,
        } satisfies ManualEditResult;
      });
      return ok(result);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('NOT_FOUND:')) return err({ kind: 'NOT_FOUND', lotId });
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /** 차수 번호만 변경 — manualUpdate(nth) 의 명시적 별칭. */
  manualMove(
    accountId: number,
    lotId: number,
    newNth: number,
  ): Result<ManualEditResult, LotsRepoError> {
    return this.manualUpdate(accountId, lotId, { nth: newNth });
  }

  /**
   * 액면분할 단가 일괄 보정 — (accountId, pdno) 의 모든 차수 buyPrice 에 ratio 곱.
   * - amountKrw = buyPrice * qty 로 재계산 (qty 는 변동 없음).
   * - ratioPct: -100 < r ≤ 1000 — 0% 는 의미 없음(no-op 거부).
   * - 상태 무관 (OPEN/SOLD 모두 적용 — 액면분할은 과거 단가도 보정해야 평가 일관).
   *   호출측이 OPEN-only 가 필요하면 향후 옵션화.
   */
  applyStockSplitRatio(
    accountId: number,
    pdno: string,
    ratioPct: number,
  ): Result<{ before: LotRow[]; after: LotRow[] }, LotsRepoError> {
    if (!Number.isFinite(ratioPct) || ratioPct <= -100 || ratioPct === 0) {
      return err({
        kind: 'CONFLICT',
        reason: `applyStockSplitRatio: ratioPct 유효 범위(-100<r≤1000, ≠0): ${ratioPct}`,
      });
    }
    try {
      const result = this.db.transaction((tx) => {
        const before = this.snapshotRowsTx(tx, accountId, pdno);
        if (before.length === 0) {
          throw new Error(`NOT_FOUND: 종목 차수 없음 (account=${accountId} pdno=${pdno})`);
        }
        const multiplier = 1 + ratioPct / 100;
        const after: LotRow[] = [];
        for (const row of before) {
          const newPrice = Math.max(1, Math.round(row.buyPrice * multiplier));
          const newAmount = newPrice * row.qty;
          tx.update(lotsTable)
            .set({ buyPrice: newPrice, amountKrw: newAmount })
            .where(eq(lotsTable.id, row.id))
            .run();
          after.push({ ...row, buyPrice: newPrice, amountKrw: newAmount });
        }
        return { before, after };
      });
      return ok(result);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('NOT_FOUND:')) return err({ kind: 'CONFLICT', reason: msg });
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * undo — 주어진 (accountId, pdno) 의 모든 차수를 baseline 스냅샷으로 복원.
   * 라우터에서 직전 변경의 audit_payload.fullSnapshot 을 인자로 전달.
   * 트랜잭션: 현재 (accountId, pdno) 모두 삭제 → snapshot rows 재삽입.
   *
   * 보안 불변식:
   *   - 같은 accountId 의 차수만 삭제. 다른 계좌는 절대 건드리지 않음.
   *   - snapshot 의 모든 row.accountId === accountId 검증.
   */
  restoreFromSnapshot(
    accountId: number,
    pdno: string,
    snapshot: LotRow[],
  ): Result<{ restored: number }, LotsRepoError> {
    for (const row of snapshot) {
      if (row.accountId !== accountId || row.pdno !== pdno) {
        return err({
          kind: 'CONFLICT',
          reason: `restoreFromSnapshot: snapshot row mismatch (account=${row.accountId}!=${accountId} or pdno=${row.pdno}!=${pdno})`,
        });
      }
    }
    try {
      const restored = this.db.transaction((tx) => {
        tx.delete(lotsTable)
          .where(and(eq(lotsTable.accountId, accountId), eq(lotsTable.pdno, pdno)))
          .run();
        let count = 0;
        for (const row of snapshot) {
          tx.insert(lotsTable)
            .values({
              accountId: row.accountId,
              pdno: row.pdno,
              nth: row.nth,
              buyPrice: row.buyPrice,
              qty: row.qty,
              amountKrw: row.amountKrw,
              status: row.status,
              boughtAt: new Date(row.boughtAt),
              soldAt: row.soldAt === null ? null : new Date(row.soldAt),
              sellPrice: row.sellPrice ?? null,
            })
            .run();
          count++;
        }
        return count;
      });
      return ok({ restored });
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
  cyclesByPdno(input: CyclesByPdnoInput): Result<TradeCycle[], LotsRepoError> {
    try {
      const conditions = [eq(lotsTable.accountId, input.accountId)];
      if (input.pdno !== undefined) {
        conditions.push(eq(lotsTable.pdno, input.pdno));
      }
      if (input.status === 'open') {
        conditions.push(inArray(lotsTable.status, ['OPEN', 'BUYING']));
      } else if (input.status === 'closed') {
        conditions.push(eq(lotsTable.status, 'SOLD'));
      }
      // 'all' 은 status 조건 없음
      const rows = this.db
        .select()
        .from(lotsTable)
        .where(and(...conditions))
        .orderBy(asc(lotsTable.pdno), asc(lotsTable.nth))
        .all();
      // 종목명 캐시 (호출당 pdno → name)
      const nameCache = new Map<string, string>();
      const resolveName = (pdno: string): string => {
        const cached = nameCache.get(pdno);
        if (cached !== undefined) return cached;
        const found = this.stockMasterRepo?.find(pdno)?.name ?? '';
        nameCache.set(pdno, found);
        return found;
      };
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

  /** lots 의 raw 행 조회 — manual 라우터가 평가/미리보기에 사용. */
  listRows(accountId: number, pdno?: string): Result<LotRow[], LotsRepoError> {
    try {
      const conditions = [eq(lotsTable.accountId, accountId)];
      if (pdno !== undefined) conditions.push(eq(lotsTable.pdno, pdno));
      const rows = this.db
        .select()
        .from(lotsTable)
        .where(and(...conditions))
        .orderBy(asc(lotsTable.pdno), asc(lotsTable.nth))
        .all();
      return ok(rows.map((r) => this.toLotRow(r)));
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }
}

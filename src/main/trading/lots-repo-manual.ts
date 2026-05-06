import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lots as lotsTable } from '../db/schema';
import type { LotsRepoError } from './lots-repo-errors';
import { snapshotRowsTx, toLotRow } from './lots-repo-rows';
import type {
  LotRow,
  ManualEditResult,
  ManualInsertInput,
  ManualUpdateChanges,
} from './lots-repo-types';

/**
 * 수동 차수 직접 삽입.
 * - 동일 (accountId, pdno, nth) 존재 시 CONFLICT.
 * - 자동매매 ON 차단은 라우터 레이어 책임.
 */
export function manualInsert(
  db: Db,
  input: ManualInsertInput,
  broker: string,
): Result<ManualEditResult, LotsRepoError> {
  try {
    const result = db.transaction((tx) => {
      const fullSnapshot = snapshotRowsTx(tx, input.accountId, input.pdno, broker);
      const existing = tx
        .select({ id: lotsTable.id })
        .from(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
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
          broker,
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
        after: toLotRow(row),
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
export function manualUpdate(
  db: Db,
  accountId: number,
  lotId: number,
  changes: ManualUpdateChanges,
  broker: string,
): Result<ManualEditResult, LotsRepoError> {
  try {
    const result = db.transaction((tx) => {
      const rows = tx
        .select()
        .from(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.id, lotId),
            eq(lotsTable.accountId, accountId),
          ),
        )
        .all();
      const target = rows[0];
      if (!target) throw new Error(`NOT_FOUND: lot id=${lotId} (account=${accountId})`);
      const fullSnapshot = snapshotRowsTx(tx, accountId, target.pdno, broker);
      const before = toLotRow(target);
      // nth 변경 시 충돌 검사
      if (changes.nth !== undefined && changes.nth !== target.nth) {
        const conflict = tx
          .select({ id: lotsTable.id })
          .from(lotsTable)
          .where(
            and(
              eq(lotsTable.broker, broker),
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
        after: toLotRow(updated),
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
export function manualDelete(
  db: Db,
  accountId: number,
  lotId: number,
  broker: string,
): Result<ManualEditResult, LotsRepoError> {
  try {
    const result = db.transaction((tx) => {
      const rows = tx
        .select()
        .from(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.id, lotId),
            eq(lotsTable.accountId, accountId),
          ),
        )
        .all();
      const target = rows[0];
      if (!target) throw new Error(`NOT_FOUND: lot id=${lotId} (account=${accountId})`);
      const fullSnapshot = snapshotRowsTx(tx, accountId, target.pdno, broker);
      const before = toLotRow(target);
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

/**
 * 액면분할 단가 일괄 보정 — (accountId, pdno) 의 모든 차수 buyPrice 에 ratio 곱.
 * - amountKrw = buyPrice * qty 로 재계산 (qty 는 변동 없음).
 * - ratioPct: -100 < r ≤ 1000 — 0% 는 의미 없음(no-op 거부).
 * - 상태 무관 (OPEN/SOLD 모두 적용 — 액면분할은 과거 단가도 보정해야 평가 일관).
 *   호출측이 OPEN-only 가 필요하면 향후 옵션화.
 */
export function applyStockSplitRatio(
  db: Db,
  accountId: number,
  pdno: string,
  ratioPct: number,
  broker: string,
): Result<{ before: LotRow[]; after: LotRow[] }, LotsRepoError> {
  if (!Number.isFinite(ratioPct) || ratioPct <= -100 || ratioPct === 0) {
    return err({
      kind: 'CONFLICT',
      reason: `applyStockSplitRatio: ratioPct 유효 범위(-100<r≤1000, ≠0): ${ratioPct}`,
    });
  }
  try {
    const result = db.transaction((tx) => {
      const before = snapshotRowsTx(tx, accountId, pdno, broker);
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
 */
export function restoreFromSnapshot(
  db: Db,
  accountId: number,
  pdno: string,
  snapshot: LotRow[],
  broker: string,
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
    const restored = db.transaction((tx) => {
      tx.delete(lotsTable)
        .where(
          and(
            eq(lotsTable.broker, broker),
            eq(lotsTable.accountId, accountId),
            eq(lotsTable.pdno, pdno),
          ),
        )
        .run();
      let count = 0;
      for (const row of snapshot) {
        tx.insert(lotsTable)
          .values({
            broker,
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

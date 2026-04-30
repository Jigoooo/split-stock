import { and, asc, desc, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lotsSnapshots } from '../db/schema';
import type { LotsRepoError } from './lots-repo-errors';
import type { LotSnapshotEntry, LotsSnapshot, SaveSnapshotInput } from './lots-repo-types';

/**
 * 특정 일자의 모든 종목 차수 스냅샷 조회.
 * pdno를 지정하면 해당 종목만 반환.
 */
export function snapshotByDate(
  db: Db,
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
    const rows = db
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
export function listSnapshotDates(db: Db, accountId: number): Result<string[], LotsRepoError> {
  try {
    const rows = db
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
export function saveSnapshot(db: Db, input: SaveSnapshotInput): Result<void, LotsRepoError> {
  try {
    const now = new Date();
    db.insert(lotsSnapshots)
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

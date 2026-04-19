import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { timeWindows } from '../db/schema';

export type TradeSide = 'BUY' | 'SELL';

/**
 * 매매 시간대 레포지토리 — per-account, per-side 슬롯 1~3.
 * start_minute/end_minute: 0~1439 (00:00=0, 23:59=1439).
 */
export interface TimeWindowRow {
  id: number;
  accountId: number;
  side: TradeSide;
  slot: 1 | 2 | 3;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeWindowRepo {
  list(accountId: number): TimeWindowRow[];
  upsert(
    accountId: number,
    side: TradeSide,
    slot: 1 | 2 | 3,
    enabled: boolean,
    startMinute: number,
    endMinute: number,
  ): void;
  delete(accountId: number, side: TradeSide, slot: 1 | 2 | 3): void;
}

export function createTimeWindowRepo(db: Db): TimeWindowRepo {
  return {
    list(accountId) {
      const rows = db.select().from(timeWindows).where(eq(timeWindows.accountId, accountId)).all();
      return rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        side: r.side as TradeSide,
        slot: r.slot as 1 | 2 | 3,
        enabled: r.enabled === 1,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        createdAt: new Date(r.createdAt as unknown as number),
        updatedAt: new Date(r.updatedAt as unknown as number),
      }));
    },

    upsert(accountId, side, slot, enabled, startMinute, endMinute) {
      const now = new Date();
      // 이미 있으면 UPDATE, 없으면 INSERT
      const existing = db
        .select({ id: timeWindows.id })
        .from(timeWindows)
        .where(
          and(
            eq(timeWindows.accountId, accountId),
            eq(timeWindows.side, side),
            eq(timeWindows.slot, slot),
          ),
        )
        .get();

      if (existing) {
        db.update(timeWindows)
          .set({
            enabled: enabled ? 1 : 0,
            startMinute,
            endMinute,
            updatedAt: now,
          })
          .where(eq(timeWindows.id, existing.id))
          .run();
      } else {
        db.insert(timeWindows)
          .values({
            accountId,
            side,
            slot,
            enabled: enabled ? 1 : 0,
            startMinute,
            endMinute,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    },

    delete(accountId, side, slot) {
      db.delete(timeWindows)
        .where(
          and(
            eq(timeWindows.accountId, accountId),
            eq(timeWindows.side, side),
            eq(timeWindows.slot, slot),
          ),
        )
        .run();
    },
  };
}

/**
 * 현재 분(0~1439)이 해당 계좌/방향의 허용 시간대 안에 있는지 확인.
 *
 * 규칙:
 * - 활성화된 슬롯이 1개도 없으면 항상 허용 (미설정 = 제한 없음).
 * - 슬롯이 1개 이상 활성화되어 있으면, 그 합집합 구간 안에 nowMinutes 가 속해야 함.
 * - startMinute > endMinute 인 경우 자정 경계(예: 22:00~02:00)로 처리.
 */
export function isTradeAllowedAt(
  accountId: number,
  side: TradeSide,
  nowMinutes: number,
  repo: TimeWindowRepo,
): boolean {
  const rows = repo.list(accountId);
  const active = rows.filter((r) => r.side === side && r.enabled);

  // 슬롯 0개면 항상 허용
  if (active.length === 0) return true;

  for (const slot of active) {
    if (slot.startMinute <= slot.endMinute) {
      // 일반 구간
      if (nowMinutes >= slot.startMinute && nowMinutes <= slot.endMinute) return true;
    } else {
      // 자정 경계 구간 (e.g. 22:00=1320 ~ 02:00=120)
      if (nowMinutes >= slot.startMinute || nowMinutes <= slot.endMinute) return true;
    }
  }
  return false;
}

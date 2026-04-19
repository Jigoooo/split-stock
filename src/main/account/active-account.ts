import type { AppEnv } from '@shared/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { accounts as accountsTable } from '../db/schema';

export type ActiveAccountError =
  | { kind: 'NO_ACCOUNT'; msg: string }
  | { kind: 'NOT_FOUND'; msg: string }
  | { kind: 'DB_ERROR'; cause: unknown };

export interface AccountRow {
  id: number;
  env: AppEnv;
  accountNo8: string;
  accountProdCd: string;
  nickname: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
}

function rowToAccount(r: typeof accountsTable.$inferSelect): AccountRow {
  return {
    id: r.id,
    env: r.env as AppEnv,
    accountNo8: r.accountNo8,
    accountProdCd: r.accountProdCd,
    nickname: r.nickname,
    displayName: r.displayName ?? null,
    isActive: r.isActive === 1,
    createdAt: r.createdAt,
  };
}

/**
 * 활성 계좌 컨텍스트 — accounts 테이블의 is_active 컬럼을 단일 진실원으로 관리.
 *
 * 불변식:
 * - accounts에 행이 1개 이상이면 정확히 1개만 is_active=1.
 * - setActive(id) 는 트랜잭션으로 모두 0 → 대상 1로 교체.
 * - ensureActive() 는 부팅 시 1회 호출. 활성이 없으면 첫 계좌 활성화.
 *
 * 보안 노트: 이 헬퍼가 반환한 accountId 가 모든 도메인 리포지토리(lots/safety/credentials)의
 * 격리 기준이 된다. 잘못된 fallback 은 다른 계좌 자금을 잘못 거래하는 사고로 이어지므로
 * 명시적 인자 우선, fallback 은 최후 수단.
 */
export class ActiveAccountRepo {
  constructor(private readonly db: Db) {}

  /**
   * 현재 활성 계좌 ID. 활성 계좌가 없으면 null.
   * 호출측은 null 인 경우 `ensureActive()` 또는 명시 시드 후 재시도.
   */
  getActiveAccountId(): number | null {
    try {
      const row = this.db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(eq(accountsTable.isActive, 1))
        .limit(1)
        .all()[0];
      return row?.id ?? null;
    } catch {
      return null;
    }
  }

  getActiveAccount(): AccountRow | null {
    try {
      const row = this.db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.isActive, 1))
        .limit(1)
        .all()[0];
      return row ? rowToAccount(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * 활성 계좌 변경 — 트랜잭션으로 모두 0 → 대상 1.
   * 대상 ID 가 존재하지 않으면 NOT_FOUND.
   */
  setActiveAccountId(id: number): Result<void, ActiveAccountError> {
    try {
      this.db.transaction((tx) => {
        const target = tx
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(eq(accountsTable.id, id))
          .all();
        if (target.length === 0) {
          throw new Error(`account not found: id=${id}`);
        }
        // 다른 모든 계좌 비활성.
        tx.update(accountsTable).set({ isActive: 0 }).run();
        tx.update(accountsTable).set({ isActive: 1 }).where(eq(accountsTable.id, id)).run();
      });
      return ok(undefined);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.startsWith('account not found')) {
        return err({ kind: 'NOT_FOUND', msg });
      }
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 활성 계좌 보장 — 부팅 시 호출.
   * - 계좌 0개: NO_ACCOUNT
   * - 계좌 N개, 활성 0개: 가장 오래된 계좌(최소 id) 활성화
   * - 계좌 N개, 활성 1개: 그대로
   * - 계좌 N개, 활성 2개 이상: 최소 id 만 남기고 나머지 0 (단일성 복구)
   */
  ensureActive(): Result<number, ActiveAccountError> {
    try {
      const result = this.db.transaction<number>((tx) => {
        const all = tx
          .select({ id: accountsTable.id, isActive: accountsTable.isActive })
          .from(accountsTable)
          .orderBy(asc(accountsTable.id))
          .all();
        if (all.length === 0) {
          throw new Error('NO_ACCOUNT');
        }
        const actives = all.filter((r) => r.isActive === 1);
        const fallbackFirst = all[0];
        if (!fallbackFirst) {
          // length === 0 은 위에서 체크했으므로 도달 불가. type narrowing 보조.
          throw new Error('NO_ACCOUNT');
        }
        if (actives.length === 1) {
          return actives[0]?.id ?? fallbackFirst.id;
        }
        // 0개 또는 2개 이상 — 첫 계좌만 활성으로 정규화.
        tx.update(accountsTable).set({ isActive: 0 }).run();
        tx.update(accountsTable)
          .set({ isActive: 1 })
          .where(eq(accountsTable.id, fallbackFirst.id))
          .run();
        return fallbackFirst.id;
      });
      return ok(result);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg === 'NO_ACCOUNT') {
        return err({ kind: 'NO_ACCOUNT', msg: '등록된 계좌가 없습니다' });
      }
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * 자격증명 저장 시점에 호출 — env+accountNo8+accountProdCd 조합으로 기존 계좌
   * 검색, 없으면 신규 생성. 첫 계좌면 활성화.
   * 반환: 계좌 ID.
   */
  upsertFromCredentials(input: {
    env: AppEnv;
    accountNo8: string;
    accountProdCd: string;
    nickname?: string;
    displayName?: string | null;
  }): Result<number, ActiveAccountError> {
    try {
      const id = this.db.transaction<number>((tx) => {
        const existing = tx
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(
            and(
              eq(accountsTable.env, input.env),
              eq(accountsTable.accountNo8, input.accountNo8),
              eq(accountsTable.accountProdCd, input.accountProdCd),
            ),
          )
          .all()[0];
        if (existing) {
          return existing.id;
        }
        const inserted = tx
          .insert(accountsTable)
          .values({
            env: input.env,
            accountNo8: input.accountNo8,
            accountProdCd: input.accountProdCd,
            nickname: input.nickname ?? '',
            displayName: input.displayName ?? null,
            createdAt: new Date(),
            isActive: 0,
          })
          .returning({ id: accountsTable.id })
          .all();
        const row = inserted[0];
        if (!row) throw new Error('insert returned no row');
        // 첫 계좌라면 자동 활성화.
        const cnt = tx.select({ c: sql<number>`count(*)` }).from(accountsTable).all()[0]?.c;
        if (cnt === 1) {
          tx.update(accountsTable).set({ isActive: 1 }).where(eq(accountsTable.id, row.id)).run();
        }
        return row.id;
      });
      return ok(id);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  list(): AccountRow[] {
    try {
      const rows = this.db.select().from(accountsTable).orderBy(asc(accountsTable.id)).all();
      return rows.map(rowToAccount);
    } catch {
      return [];
    }
  }

  getById(id: number): AccountRow | null {
    try {
      const row = this.db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.id, id))
        .limit(1)
        .all()[0];
      return row ? rowToAccount(row) : null;
    } catch {
      return null;
    }
  }
}

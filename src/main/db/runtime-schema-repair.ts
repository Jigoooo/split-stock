import { sql } from 'drizzle-orm';
import type { Db } from './client';

interface SqliteTableInfoRow {
  name: string;
}

function listColumns(db: Db, tableName: string): string[] {
  try {
    return db
      .all<SqliteTableInfoRow>(sql.raw(`PRAGMA table_info(${tableName})`))
      .map((r) => r.name);
  } catch {
    return [];
  }
}

/**
 * 일부 개발 DB에서 drizzle journal 과 실제 accounts 컬럼이 어긋난 상태를 복구한다.
 * 이 상태면 ActiveAccountRepo 의 SELECT * / sort_order update 가 실패해
 * "대상 계좌를 찾을 수 없습니다"와 "정렬 변경 실패: DB_ERROR"가 연쇄 발생한다.
 */
export function repairAccountsRuntimeSchema(db: Db): void {
  const before = new Set(listColumns(db, 'accounts'));
  if (before.size === 0) {
    return;
  }

  try {
    if (!before.has('broker')) {
      db.run(sql.raw("ALTER TABLE accounts ADD broker TEXT NOT NULL DEFAULT 'KIS'"));
    }

    if (!before.has('sort_order')) {
      db.run(sql.raw('ALTER TABLE accounts ADD sort_order INTEGER NOT NULL DEFAULT 0'));
      db.run(
        sql.raw(`UPDATE accounts
SET sort_order = (
  SELECT COUNT(*) FROM accounts AS a2
  WHERE a2.created_at < accounts.created_at
     OR (a2.created_at = accounts.created_at AND a2.id <= accounts.id)
)`),
      );
    }
  } catch {
    return;
  }
}

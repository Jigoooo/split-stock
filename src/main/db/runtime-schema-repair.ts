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

/**
 * 개발/패키지 DB에서 drizzle journal timestamp 순서가 꼬여 0015 캐시 테이블이
 * 스킵된 상태를 복구한다. 모두 캐시 테이블이라 기존 도메인 데이터와 독립적이다.
 */
export function repairMarketContextRuntimeSchema(db: Db): void {
  try {
    db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS krx_daily_trade_cache (
        market TEXT NOT NULL,
        pdno TEXT NOT NULL,
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        close INTEGER,
        change INTEGER,
        change_rate REAL,
        open INTEGER,
        high INTEGER,
        low INTEGER,
        volume INTEGER,
        trade_value INTEGER,
        market_cap INTEGER,
        listed_shares INTEGER,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (market, pdno, date)
      )`),
    );
    db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS krx_base_info_cache (
        market TEXT NOT NULL,
        pdno TEXT NOT NULL,
        date TEXT NOT NULL,
        isin TEXT,
        name TEXT NOT NULL,
        short_name TEXT,
        english_name TEXT,
        listed_at TEXT,
        market_name TEXT,
        security_group TEXT,
        section TEXT,
        stock_kind TEXT,
        par_value TEXT,
        listed_shares INTEGER,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (market, pdno, date)
      )`),
    );
    db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS ecos_series_cache (
        indicator TEXT NOT NULL,
        stat_code TEXT NOT NULL,
        item_code TEXT NOT NULL,
        frequency TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL NOT NULL,
        unit_name TEXT,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (indicator, date)
      )`),
    );
  } catch {
    return;
  }
}

export function repairTradingCalendarRuntimeSchema(db: Db): void {
  try {
    db.run(
      sql.raw(`CREATE TABLE IF NOT EXISTS trading_calendar_days (
        date TEXT PRIMARY KEY,
        open_day INTEGER NOT NULL,
        open_minute INTEGER,
        close_minute INTEGER,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        source_version TEXT,
        updated_at INTEGER NOT NULL
      )`),
    );
  } catch {
    return;
  }
}

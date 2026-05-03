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

export function repairCryptoRuntimeSchema(db: Db): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS crypto_instruments (
      exchange TEXT NOT NULL,
      market TEXT NOT NULL,
      korean_name TEXT NOT NULL,
      english_name TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      base_currency TEXT NOT NULL,
      market_warning TEXT NOT NULL DEFAULT 'NONE',
      raw_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (exchange, market)
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_candles (
      exchange TEXT NOT NULL,
      market TEXT NOT NULL,
      unit TEXT NOT NULL,
      candle_at INTEGER NOT NULL,
      open TEXT NOT NULL,
      high TEXT NOT NULL,
      low TEXT NOT NULL,
      close TEXT NOT NULL,
      volume TEXT NOT NULL,
      trade_price TEXT NOT NULL,
      raw_json TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (exchange, market, unit, candle_at)
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL,
      market TEXT NOT NULL,
      uuid TEXT,
      identifier TEXT,
      side TEXT NOT NULL,
      ord_type TEXT NOT NULL,
      state TEXT NOT NULL,
      price TEXT,
      volume TEXT,
      remaining_volume TEXT NOT NULL DEFAULT '0',
      executed_volume TEXT NOT NULL DEFAULT '0',
      paid_fee TEXT NOT NULL DEFAULT '0',
      locked TEXT NOT NULL DEFAULT '0',
      raw_json TEXT,
      placed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crypto_orders_account_uuid_uniq ON crypto_orders(account_id, uuid)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crypto_orders_account_identifier_uniq ON crypto_orders(account_id, identifier)`,
    `CREATE TABLE IF NOT EXISTS crypto_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL,
      order_uuid TEXT NOT NULL,
      trade_uuid TEXT,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      price TEXT NOT NULL,
      volume TEXT NOT NULL,
      funds TEXT NOT NULL DEFAULT '0',
      fee TEXT NOT NULL DEFAULT '0',
      raw_json TEXT,
      executed_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crypto_fills_account_trade_uniq ON crypto_fills(account_id, trade_uuid)`,
    `CREATE TABLE IF NOT EXISTS crypto_balances (
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance TEXT NOT NULL,
      locked TEXT NOT NULL,
      avg_buy_price TEXT NOT NULL,
      unit_currency TEXT NOT NULL,
      raw_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, exchange, currency)
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_realtime_checkpoints (
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL,
      stream TEXT NOT NULL,
      last_event_at INTEGER NOT NULL,
      cursor_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, exchange, stream)
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_auto_configs (
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'UPBIT',
      market TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'disabled',
      emergency_disabled INTEGER NOT NULL DEFAULT 1,
      base_order_krw TEXT NOT NULL DEFAULT '5000',
      max_order_krw TEXT NOT NULL DEFAULT '5000',
      max_total_exposure_krw TEXT NOT NULL DEFAULT '50000',
      min_order_total_krw TEXT NOT NULL DEFAULT '5000',
      add_trigger_pct TEXT NOT NULL DEFAULT '0.03',
      take_profit_pct TEXT NOT NULL DEFAULT '0.02',
      max_open_lots INTEGER NOT NULL DEFAULT 3,
      cooldown_ms INTEGER NOT NULL DEFAULT 60000,
      stale_cancel_cap INTEGER NOT NULL DEFAULT 3,
      require_readonly_smoke INTEGER NOT NULL DEFAULT 1,
      require_dry_run_history_before_live INTEGER NOT NULL DEFAULT 1,
      strategy_json TEXT,
      last_dry_run_at INTEGER,
      last_readonly_smoke_at INTEGER,
      last_live_action_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, exchange, market)
    )`,
    `CREATE TABLE IF NOT EXISTS crypto_auto_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      exchange TEXT NOT NULL DEFAULT 'UPBIT',
      market TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'PAUSED',
      entry_condition_json TEXT NOT NULL DEFAULT '{"type":"immediate","price":null}',
      strategy_json TEXT NOT NULL,
      guard_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crypto_auto_watches_account_market_uniq ON crypto_auto_watches(account_id, exchange, market)`,
    `CREATE TABLE IF NOT EXISTS crypto_auto_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      strategy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crypto_auto_templates_account_name_uniq ON crypto_auto_templates(account_id, name)`,
  ];
  try {
    for (const statement of statements) {
      db.run(sql.raw(statement));
    }
    const autoColumns = new Set(listColumns(db, 'crypto_auto_configs'));
    if (autoColumns.size > 0 && !autoColumns.has('strategy_json')) {
      db.run(sql.raw('ALTER TABLE crypto_auto_configs ADD COLUMN strategy_json TEXT'));
    }
  } catch {
    return;
  }
}

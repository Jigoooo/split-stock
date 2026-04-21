import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * drizzle-kit 생성 마이그레이션이 없을 때 쓰는 raw CREATE.
 * 테스트용 인메모리 DB에서 스키마를 즉시 구축할 때 사용.
 * 운영 DB는 반드시 drizzle-kit 마이그레이션(`pnpm db:generate` → `migrate()`) 사용.
 *
 * 중요: schema.ts와 항상 동기화해야 한다. 누락 시 테스트는 통과하나 운영 DB와 어긋남.
 */
const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS credentials (
    account_id INTEGER PRIMARY KEY,
    env TEXT NOT NULL,
    payload BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credentials_env_uniq ON credentials(env)`,
  `CREATE TABLE IF NOT EXISTS access_tokens (
    env TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at INTEGER NOT NULL,
    issued_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    env TEXT NOT NULL,
    account_no_8 TEXT NOT NULL,
    account_prod_cd TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    display_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    pdno TEXT NOT NULL,
    nth INTEGER NOT NULL,
    buy_price INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    amount_krw INTEGER NOT NULL,
    status TEXT NOT NULL,
    bought_at INTEGER NOT NULL,
    sold_at INTEGER,
    sell_price INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    lot_id INTEGER,
    odno TEXT NOT NULL,
    org_no TEXT,
    pdno TEXT NOT NULL,
    side TEXT NOT NULL,
    division TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL,
    placed_at INTEGER NOT NULL,
    filled_at INTEGER,
    cancel_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER NOT NULL,
    executed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT,
    audit_payload TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stock_master (
    pdno TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sector TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prebuy_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    pdno TEXT NOT NULL,
    target_price INTEGER NOT NULL,
    amount_krw INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_candles (
    pdno TEXT NOT NULL,
    period TEXT NOT NULL,
    date TEXT NOT NULL,
    open INTEGER NOT NULL,
    high INTEGER NOT NULL,
    low INTEGER NOT NULL,
    close INTEGER NOT NULL,
    volume INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (pdno, period, date)
  )`,
  `CREATE TABLE IF NOT EXISTS lots_snapshots (
    account_id INTEGER NOT NULL,
    snapshot_date TEXT NOT NULL,
    pdno TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    current_price INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, snapshot_date, pdno)
  )`,
  `CREATE TABLE IF NOT EXISTS watch_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    pdno TEXT NOT NULL,
    source TEXT NOT NULL,
    side TEXT NOT NULL,
    target_price INTEGER NOT NULL,
    comparator TEXT NOT NULL,
    order_type TEXT NOT NULL,
    qty_or_amount_mode TEXT NOT NULL,
    qty INTEGER,
    amount_krw INTEGER,
    nth INTEGER,
    source_ref_id TEXT,
    expires_at INTEGER,
    status TEXT NOT NULL,
    last_failure_reason TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    executed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS time_windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    side TEXT NOT NULL,
    slot INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbol_memos (
    pdno TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS protection_limits (
    account_id INTEGER PRIMARY KEY,
    per_symbol_daily_max_buys INTEGER,
    daily_total_max_amount INTEGER,
    daily_total_max_count INTEGER,
    account_total_max_amount INTEGER,
    rate_guard_enabled INTEGER NOT NULL DEFAULT 0,
    rate_guard_window_seconds INTEGER DEFAULT 40,
    rate_guard_max_count INTEGER DEFAULT 5,
    updated_at INTEGER NOT NULL
  )`,
];

/**
 * drizzle의 `db.run(sql.raw(...))`으로 DDL을 실행한다.
 * child_process가 아닌 순수 SQLite DDL 실행이다.
 */
export function bootstrapSchema(db: Db): void {
  for (const stmt of CREATE_STATEMENTS) {
    db.run(sql.raw(stmt));
  }
}

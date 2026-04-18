import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * drizzle-kit 생성 마이그레이션이 없을 때 쓰는 raw CREATE.
 * 테스트용 인메모리 DB에서 스키마를 즉시 구축할 때 사용.
 * 운영 DB는 반드시 drizzle-kit 마이그레이션(`pnpm db:generate` → `migrate()`) 사용.
 */
const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS credentials (
    env TEXT PRIMARY KEY,
    payload BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
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
    created_at INTEGER NOT NULL
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
    payload_json TEXT
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
    pdno TEXT NOT NULL,
    target_price INTEGER NOT NULL,
    amount_krw INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
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

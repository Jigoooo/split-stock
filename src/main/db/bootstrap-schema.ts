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
    broker TEXT NOT NULL DEFAULT 'KIS',
    payload BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credentials_env_broker_uniq ON credentials(env, broker)`,
  `CREATE TABLE IF NOT EXISTS access_tokens (
    broker TEXT NOT NULL DEFAULT 'KIS',
    env TEXT NOT NULL,
    token TEXT NOT NULL,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    PRIMARY KEY (broker, env)
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    env TEXT NOT NULL,
    broker TEXT NOT NULL DEFAULT 'KIS',
    account_no_8 TEXT NOT NULL,
    account_prod_cd TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL DEFAULT 'KIS',
    account_id INTEGER NOT NULL,
    pdno TEXT NOT NULL,
    nth INTEGER NOT NULL,
    buy_price INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    amount_krw INTEGER NOT NULL,
    qty_decimal TEXT,
    buy_price_decimal TEXT,
    amount_krw_decimal TEXT,
    status TEXT NOT NULL,
    bought_at INTEGER NOT NULL,
    sold_at INTEGER,
    sell_price INTEGER,
    sell_price_decimal TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL DEFAULT 'KIS',
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
    broker TEXT NOT NULL DEFAULT 'KIS',
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
  `CREATE TABLE IF NOT EXISTS crypto_auto_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    exchange TEXT NOT NULL DEFAULT 'UPBIT',
    market TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'dry-run',
    sequence INTEGER NOT NULL,
    quantity TEXT NOT NULL,
    avg_entry_krw TEXT NOT NULL,
    allocated_krw TEXT NOT NULL,
    realized_pnl TEXT NOT NULL DEFAULT '0',
    fees_paid TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS crypto_auto_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    exchange TEXT NOT NULL DEFAULT 'UPBIT',
    market TEXT NOT NULL,
    mode TEXT NOT NULL,
    kind TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    intent_json TEXT,
    result_json TEXT,
    idempotency_key TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crypto_auto_events_idempotency_uniq ON crypto_auto_events(account_id, idempotency_key)`,
  `CREATE TABLE IF NOT EXISTS lots_snapshots (
    account_id INTEGER NOT NULL,
    broker TEXT NOT NULL DEFAULT 'KIS',
    snapshot_date TEXT NOT NULL,
    pdno TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    current_price INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, snapshot_date, pdno)
  )`,
  `CREATE TABLE IF NOT EXISTS trading_calendar_days (
    date TEXT PRIMARY KEY,
    open_day INTEGER NOT NULL,
    open_minute INTEGER,
    close_minute INTEGER,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    source_version TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS watch_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL DEFAULT 'KIS',
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
    broker TEXT NOT NULL DEFAULT 'KIS',
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS crypto_market_memos (
    market TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS protection_limits (
    account_id INTEGER PRIMARY KEY,
    per_symbol_daily_max_buys_enabled INTEGER NOT NULL DEFAULT 0,
    per_symbol_daily_max_buys INTEGER,
    daily_total_max_amount_enabled INTEGER NOT NULL DEFAULT 0,
    daily_total_max_amount INTEGER,
    daily_total_max_count_enabled INTEGER NOT NULL DEFAULT 0,
    daily_total_max_count INTEGER,
    account_total_max_amount_enabled INTEGER NOT NULL DEFAULT 0,
    account_total_max_amount INTEGER,
    rate_guard_enabled INTEGER NOT NULL DEFAULT 0,
    rate_guard_window_seconds INTEGER DEFAULT 40,
    rate_guard_max_count INTEGER DEFAULT 5,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS krx_daily_trade_cache (
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
  )`,
  `CREATE TABLE IF NOT EXISTS krx_base_info_cache (
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
  )`,
  `CREATE TABLE IF NOT EXISTS ecos_series_cache (
    indicator TEXT NOT NULL,
    stat_code TEXT NOT NULL,
    item_code TEXT NOT NULL,
    frequency TEXT NOT NULL,
    date TEXT NOT NULL,
    value REAL NOT NULL,
    unit_name TEXT,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (indicator, date)
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

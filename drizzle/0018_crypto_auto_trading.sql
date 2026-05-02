CREATE TABLE IF NOT EXISTS crypto_auto_configs (
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
  last_dry_run_at INTEGER,
  last_readonly_smoke_at INTEGER,
  last_live_action_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, exchange, market)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_auto_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'UPBIT',
  market TEXT NOT NULL,
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_auto_events (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crypto_auto_events_idempotency_uniq ON crypto_auto_events(account_id, idempotency_key);

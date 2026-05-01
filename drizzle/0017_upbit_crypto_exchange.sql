CREATE TABLE IF NOT EXISTS crypto_instruments (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_candles (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_orders (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crypto_orders_account_uuid_uniq ON crypto_orders(account_id, uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crypto_orders_account_identifier_uniq ON crypto_orders(account_id, identifier);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_fills (
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crypto_fills_account_trade_uniq ON crypto_fills(account_id, trade_uuid);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_balances (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crypto_realtime_checkpoints (
  account_id INTEGER NOT NULL,
  exchange TEXT NOT NULL,
  stream TEXT NOT NULL,
  last_event_at INTEGER NOT NULL,
  cursor_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, exchange, stream)
);

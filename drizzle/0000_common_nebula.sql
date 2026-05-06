CREATE TABLE `access_tokens` (
	`broker` text DEFAULT 'KIS' NOT NULL,
	`env` text NOT NULL,
	`token` text NOT NULL,
	`token_type` text DEFAULT 'Bearer' NOT NULL,
	`expires_at` integer NOT NULL,
	`issued_at` integer NOT NULL,
	PRIMARY KEY(`broker`, `env`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`env` text NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`account_no_8` text NOT NULL,
	`account_prod_cd` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`is_active` integer DEFAULT 0 NOT NULL,
	`display_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_provider_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`encrypted_api_key` blob NOT NULL,
	`api_key_masked` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_configs_default_uniq` ON `ai_provider_configs` (`is_default`) WHERE is_default = 1;--> statement-breakpoint
CREATE TABLE `credentials` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`env` text NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`payload` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_env_broker_uniq` ON `credentials` (`env`,`broker`);--> statement-breakpoint
CREATE TABLE `crypto_auto_configs` (
	`account_id` integer NOT NULL,
	`exchange` text DEFAULT 'UPBIT' NOT NULL,
	`market` text NOT NULL,
	`mode` text DEFAULT 'disabled' NOT NULL,
	`emergency_disabled` integer DEFAULT true NOT NULL,
	`base_order_krw` text DEFAULT '5000' NOT NULL,
	`max_order_krw` text DEFAULT '5000' NOT NULL,
	`max_total_exposure_krw` text DEFAULT '50000' NOT NULL,
	`min_order_total_krw` text DEFAULT '5000' NOT NULL,
	`add_trigger_pct` text DEFAULT '0.03' NOT NULL,
	`take_profit_pct` text DEFAULT '0.02' NOT NULL,
	`max_open_lots` integer DEFAULT 3 NOT NULL,
	`cooldown_ms` integer DEFAULT 60000 NOT NULL,
	`stale_cancel_cap` integer DEFAULT 3 NOT NULL,
	`require_readonly_smoke` integer DEFAULT true NOT NULL,
	`require_dry_run_history_before_live` integer DEFAULT true NOT NULL,
	`strategy_json` text,
	`last_dry_run_at` integer,
	`last_readonly_smoke_at` integer,
	`last_live_action_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `exchange`, `market`)
);
--> statement-breakpoint
CREATE TABLE `crypto_auto_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`strategy_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_auto_templates_account_name_uniq` ON `crypto_auto_templates` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `crypto_auto_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`exchange` text DEFAULT 'UPBIT' NOT NULL,
	`market` text NOT NULL,
	`label` text,
	`status` text DEFAULT 'PAUSED' NOT NULL,
	`entry_condition_json` text DEFAULT '{"type":"immediate","price":null}' NOT NULL,
	`strategy_json` text NOT NULL,
	`guard_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_auto_watches_account_market_uniq` ON `crypto_auto_watches` (`account_id`,`exchange`,`market`);--> statement-breakpoint
CREATE TABLE `crypto_balances` (
	`account_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`currency` text NOT NULL,
	`balance` text NOT NULL,
	`locked` text NOT NULL,
	`avg_buy_price` text NOT NULL,
	`unit_currency` text NOT NULL,
	`raw_json` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `exchange`, `currency`)
);
--> statement-breakpoint
CREATE TABLE `crypto_candles` (
	`exchange` text NOT NULL,
	`market` text NOT NULL,
	`unit` text NOT NULL,
	`candle_at` integer NOT NULL,
	`open` text NOT NULL,
	`high` text NOT NULL,
	`low` text NOT NULL,
	`close` text NOT NULL,
	`volume` text NOT NULL,
	`trade_price` text NOT NULL,
	`raw_json` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`exchange`, `market`, `unit`, `candle_at`)
);
--> statement-breakpoint
CREATE TABLE `crypto_fills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`order_uuid` text NOT NULL,
	`trade_uuid` text,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`price` text NOT NULL,
	`volume` text NOT NULL,
	`funds` text DEFAULT '0' NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`raw_json` text,
	`executed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_fills_account_trade_uniq` ON `crypto_fills` (`account_id`,`trade_uuid`);--> statement-breakpoint
CREATE TABLE `crypto_instruments` (
	`exchange` text NOT NULL,
	`market` text NOT NULL,
	`korean_name` text NOT NULL,
	`english_name` text NOT NULL,
	`quote_currency` text NOT NULL,
	`base_currency` text NOT NULL,
	`market_warning` text DEFAULT 'NONE' NOT NULL,
	`raw_json` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`exchange`, `market`)
);
--> statement-breakpoint
CREATE TABLE `crypto_market_memos` (
	`market` text PRIMARY KEY NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crypto_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`market` text NOT NULL,
	`uuid` text,
	`identifier` text,
	`side` text NOT NULL,
	`ord_type` text NOT NULL,
	`state` text NOT NULL,
	`price` text,
	`volume` text,
	`remaining_volume` text DEFAULT '0' NOT NULL,
	`executed_volume` text DEFAULT '0' NOT NULL,
	`paid_fee` text DEFAULT '0' NOT NULL,
	`locked` text DEFAULT '0' NOT NULL,
	`raw_json` text,
	`placed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_orders_account_uuid_uniq` ON `crypto_orders` (`account_id`,`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_orders_account_identifier_uniq` ON `crypto_orders` (`account_id`,`identifier`);--> statement-breakpoint
CREATE TABLE `crypto_realtime_checkpoints` (
	`account_id` integer NOT NULL,
	`exchange` text NOT NULL,
	`stream` text NOT NULL,
	`last_event_at` integer NOT NULL,
	`cursor_json` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `exchange`, `stream`)
);
--> statement-breakpoint
CREATE TABLE `daily_candles` (
	`pdno` text NOT NULL,
	`period` text NOT NULL,
	`date` text NOT NULL,
	`open` integer NOT NULL,
	`high` integer NOT NULL,
	`low` integer NOT NULL,
	`close` integer NOT NULL,
	`volume` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`pdno`, `period`, `date`)
);
--> statement-breakpoint
CREATE TABLE `dart_corp_codes` (
	`stock_code` text PRIMARY KEY NOT NULL,
	`corp_code` text NOT NULL,
	`corp_name` text NOT NULL,
	`modify_date` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ecos_series_cache` (
	`indicator` text NOT NULL,
	`stat_code` text NOT NULL,
	`item_code` text NOT NULL,
	`frequency` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`unit_name` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`indicator`, `date`)
);
--> statement-breakpoint
CREATE TABLE `event_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`payload_json` text,
	`audit_payload` text,
	`account_id` integer,
	`broker` text,
	`pdno` text,
	`idempotency_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_logs_idempotency_uniq` ON `event_logs` (`account_id`,`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `krx_base_info_cache` (
	`market` text NOT NULL,
	`pdno` text NOT NULL,
	`date` text NOT NULL,
	`isin` text,
	`name` text NOT NULL,
	`short_name` text,
	`english_name` text,
	`listed_at` text,
	`market_name` text,
	`security_group` text,
	`section` text,
	`stock_kind` text,
	`par_value` text,
	`listed_shares` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`market`, `pdno`, `date`)
);
--> statement-breakpoint
CREATE TABLE `krx_daily_trade_cache` (
	`market` text NOT NULL,
	`pdno` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`close` integer,
	`change` integer,
	`change_rate` real,
	`open` integer,
	`high` integer,
	`low` integer,
	`volume` integer,
	`trade_value` integer,
	`market_cap` integer,
	`listed_shares` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`market`, `pdno`, `date`)
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`account_id` integer NOT NULL,
	`pdno` text NOT NULL,
	`nth` integer NOT NULL,
	`buy_price` integer NOT NULL,
	`qty` integer NOT NULL,
	`amount_krw` integer NOT NULL,
	`qty_decimal` text,
	`buy_price_decimal` text,
	`amount_krw_decimal` text,
	`source` text,
	`status` text NOT NULL,
	`bought_at` integer NOT NULL,
	`sold_at` integer,
	`sell_price` integer,
	`sell_price_decimal` text
);
--> statement-breakpoint
CREATE TABLE `lots_snapshots` (
	`account_id` integer NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`snapshot_date` text NOT NULL,
	`pdno` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`current_price` integer DEFAULT 0 NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `snapshot_date`, `pdno`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`account_id` integer NOT NULL,
	`lot_id` integer,
	`odno` text NOT NULL,
	`org_no` text,
	`pdno` text NOT NULL,
	`side` text NOT NULL,
	`division` text NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`status` text NOT NULL,
	`placed_at` integer NOT NULL,
	`filled_at` integer,
	`cancel_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prebuy_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer,
	`pdno` text NOT NULL,
	`target_price` integer NOT NULL,
	`amount_krw` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `protection_limits` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`per_symbol_daily_max_buys_enabled` integer DEFAULT 0 NOT NULL,
	`per_symbol_daily_max_buys` integer,
	`daily_total_max_amount_enabled` integer DEFAULT 0 NOT NULL,
	`daily_total_max_amount` integer,
	`daily_total_max_count_enabled` integer DEFAULT 0 NOT NULL,
	`daily_total_max_count` integer,
	`account_total_max_amount_enabled` integer DEFAULT 0 NOT NULL,
	`account_total_max_amount` integer,
	`rate_guard_enabled` integer DEFAULT 0 NOT NULL,
	`rate_guard_window_seconds` integer DEFAULT 40,
	`rate_guard_max_count` integer DEFAULT 5,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_master` (
	`pdno` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symbol_memos` (
	`pdno` text PRIMARY KEY NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_windows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`side` text NOT NULL,
	`slot` integer NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`order_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`executed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trading_calendar_days` (
	`date` text PRIMARY KEY NOT NULL,
	`open_day` integer NOT NULL,
	`open_minute` integer,
	`close_minute` integer,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`source_version` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker` text DEFAULT 'KIS' NOT NULL,
	`account_id` integer NOT NULL,
	`pdno` text NOT NULL,
	`source` text NOT NULL,
	`side` text NOT NULL,
	`target_price` integer NOT NULL,
	`comparator` text NOT NULL,
	`order_type` text NOT NULL,
	`qty_or_amount_mode` text NOT NULL,
	`qty` integer,
	`amount_krw` integer,
	`nth` integer,
	`source_ref_id` text,
	`expires_at` integer,
	`status` text NOT NULL,
	`last_failure_reason` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`executed_at` integer
);

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

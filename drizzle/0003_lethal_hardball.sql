CREATE TABLE `protection_limits` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`per_symbol_daily_max_buys` integer,
	`daily_total_max_amount` integer,
	`daily_total_max_count` integer,
	`account_total_max_amount` integer,
	`rate_guard_enabled` integer DEFAULT 0 NOT NULL,
	`rate_guard_window_seconds` integer DEFAULT 40,
	`rate_guard_max_count` integer DEFAULT 5,
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
ALTER TABLE `accounts` ADD `is_active` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `event_logs` ADD `audit_payload` text;
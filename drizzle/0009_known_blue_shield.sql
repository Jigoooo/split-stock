ALTER TABLE `protection_limits` ADD `per_symbol_daily_max_buys_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `protection_limits` ADD `daily_total_max_amount_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `protection_limits` ADD `daily_total_max_count_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `protection_limits` ADD `account_total_max_amount_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `protection_limits`
SET `per_symbol_daily_max_buys_enabled` = 1
WHERE `per_symbol_daily_max_buys` IS NOT NULL;--> statement-breakpoint
UPDATE `protection_limits`
SET `daily_total_max_amount_enabled` = 1
WHERE `daily_total_max_amount` IS NOT NULL;--> statement-breakpoint
UPDATE `protection_limits`
SET `daily_total_max_count_enabled` = 1
WHERE `daily_total_max_count` IS NOT NULL;--> statement-breakpoint
UPDATE `protection_limits`
SET `account_total_max_amount_enabled` = 1
WHERE `account_total_max_amount` IS NOT NULL;

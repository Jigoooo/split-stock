ALTER TABLE `prebuy_orders` ADD `account_id` integer;--> statement-breakpoint
ALTER TABLE `watch_orders` ADD `source_ref_id` text;--> statement-breakpoint
ALTER TABLE `watch_orders` ADD `metadata` text;
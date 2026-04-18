CREATE TABLE `prebuy_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pdno` text NOT NULL,
	`target_price` integer NOT NULL,
	`amount_krw` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_master` (
	`pdno` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `org_no` text;
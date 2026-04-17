CREATE TABLE `access_tokens` (
	`env` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`token_type` text DEFAULT 'Bearer' NOT NULL,
	`expires_at` integer NOT NULL,
	`issued_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`env` text NOT NULL,
	`account_no_8` text NOT NULL,
	`account_prod_cd` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`env` text PRIMARY KEY NOT NULL,
	`payload` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`payload_json` text
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`pdno` text NOT NULL,
	`nth` integer NOT NULL,
	`buy_price` integer NOT NULL,
	`qty` integer NOT NULL,
	`amount_krw` integer NOT NULL,
	`status` text NOT NULL,
	`bought_at` integer NOT NULL,
	`sold_at` integer,
	`sell_price` integer
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`lot_id` integer,
	`odno` text NOT NULL,
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
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`executed_at` integer NOT NULL
);

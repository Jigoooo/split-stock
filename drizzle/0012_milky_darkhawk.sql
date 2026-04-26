CREATE TABLE `dart_corp_codes` (
	`stock_code` text PRIMARY KEY NOT NULL,
	`corp_code` text NOT NULL,
	`corp_name` text NOT NULL,
	`modify_date` text,
	`fetched_at` integer NOT NULL
);

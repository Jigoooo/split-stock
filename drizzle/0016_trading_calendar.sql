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

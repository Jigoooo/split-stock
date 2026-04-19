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

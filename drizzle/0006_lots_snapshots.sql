-- lots_snapshots 테이블 추가 — 일자별 차수 스냅샷 이력.
CREATE TABLE `lots_snapshots` (
	`account_id` integer NOT NULL,
	`snapshot_date` text NOT NULL,
	`pdno` text NOT NULL,
	`name` text NOT NULL DEFAULT '',
	`current_price` integer NOT NULL DEFAULT 0,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `snapshot_date`, `pdno`)
);

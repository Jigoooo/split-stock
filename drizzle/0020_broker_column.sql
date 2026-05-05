-- Phase R0: 6개 stock 테이블에 broker 컬럼 추가 (default 'KIS')
-- 코인 데이터 ETL 수용 준비 — 기존 KIS row 무영향 (no-op).
-- broker default 'KIS' 적용 시 SQLite 가 기존 row 모두 'KIS' 로 backfill.

ALTER TABLE lots ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
ALTER TABLE symbol_memos ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
ALTER TABLE watch_orders ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
ALTER TABLE lots_snapshots ADD COLUMN broker TEXT NOT NULL DEFAULT 'KIS';

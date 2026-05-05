-- Phase R0-6: 코인 자동매매 엔진 흡수 prerequisite.
--
-- lots 테이블 source 컬럼 추가 — KIS=NULL, UPBIT='dry-run'|'live' 분리.
-- exposure gate (live 만 합산) + mode 별 lot 분리 invariant.
--
-- event_logs 에 indexed query/idempotency 보장 컬럼 + UNIQUE INDEX.
-- 코인 자동매매 live tick 의 중복 발사 방지.

ALTER TABLE lots ADD COLUMN source TEXT;
--> statement-breakpoint
ALTER TABLE event_logs ADD COLUMN account_id INTEGER;
--> statement-breakpoint
ALTER TABLE event_logs ADD COLUMN broker TEXT;
--> statement-breakpoint
ALTER TABLE event_logs ADD COLUMN pdno TEXT;
--> statement-breakpoint
ALTER TABLE event_logs ADD COLUMN idempotency_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX event_logs_idempotency_uniq ON event_logs(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

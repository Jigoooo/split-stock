-- Phase R4-3: crypto_auto_lots / crypto_auto_events 테이블 DROP.
-- R3-3 (commit 0cb70be) 에서 자동매매 엔진이 stock lots / event_logs 로 write 전환됨.
-- R4-1 ~ R4-2 에서 사용처 0 확인. 안전하게 제거.
--
-- 사용자 결정: 데이터 없음, 초기화 OK (R1 ETL skip 결정 시 명시).

DROP INDEX IF EXISTS crypto_auto_events_idempotency_uniq;
--> statement-breakpoint
DROP TABLE IF EXISTS crypto_auto_lots;
--> statement-breakpoint
DROP TABLE IF EXISTS crypto_auto_events;

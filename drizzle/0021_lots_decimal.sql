-- Phase R0-5: lots 테이블에 nullable decimal 컬럼 추가 — 코인 fractional 수량/가격 수용.
-- KIS row 는 NULL 유지 (기존 integer 컬럼 그대로). UPBIT row 는 DecimalString 저장.
-- broker 분기로 UI/repo 가 적절한 컬럼 read 하는 패턴.

ALTER TABLE lots ADD COLUMN qty_decimal TEXT;
--> statement-breakpoint
ALTER TABLE lots ADD COLUMN buy_price_decimal TEXT;
--> statement-breakpoint
ALTER TABLE lots ADD COLUMN amount_krw_decimal TEXT;
--> statement-breakpoint
ALTER TABLE lots ADD COLUMN sell_price_decimal TEXT;

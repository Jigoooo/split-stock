-- accounts 테이블에 broker + sort_order 컬럼 추가.
--
-- broker: credentials 와 동일하게 'KIS' default backfill (기존 row 는 모두 KIS 가정).
-- sort_order: createdAt asc 순으로 ROW_NUMBER() 시뮬레이션 채움
--   (NULL/0 초기값에서 클라이언트 fallback 정렬에 의존하지 않음).
-- 이미 0013 에서 처리된 credentials/access_tokens 변경은 본 파일에서 제외.

ALTER TABLE `accounts` ADD `broker` text DEFAULT 'KIS' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `accounts`
SET `sort_order` = (
  SELECT COUNT(*) FROM `accounts` AS `a2`
  WHERE `a2`.`created_at` < `accounts`.`created_at`
     OR (`a2`.`created_at` = `accounts`.`created_at` AND `a2`.`id` <= `accounts`.`id`)
);

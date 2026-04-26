-- Stage 5a: broker column 추가 + access_tokens PK 변경 (KIS↔Kiwoom 분리 준비)
--
-- 기존 데이터는 모두 'KIS' 브로커로 backfill — Kiwoom 활성화는 Stage 6.6 이후.
-- credentials.env unique → (env, broker) unique 로 확장: 같은 env 라도 broker 다르면 별행 가능.
-- access_tokens PK env → (broker, env): broker 별 토큰 캐시 격리 (6h 재사용 정책 보존).

ALTER TABLE `credentials` ADD COLUMN `broker` TEXT NOT NULL DEFAULT 'KIS';
--> statement-breakpoint
DROP INDEX IF EXISTS `credentials_env_uniq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_env_broker_uniq` ON `credentials` (`env`, `broker`);
--> statement-breakpoint
CREATE TABLE `access_tokens_new` (
  `broker` TEXT NOT NULL DEFAULT 'KIS',
  `env` TEXT NOT NULL,
  `token` TEXT NOT NULL,
  `token_type` TEXT NOT NULL DEFAULT 'Bearer',
  `expires_at` INTEGER NOT NULL,
  `issued_at` INTEGER NOT NULL,
  PRIMARY KEY (`broker`, `env`)
);
--> statement-breakpoint
INSERT INTO `access_tokens_new` (`broker`, `env`, `token`, `token_type`, `expires_at`, `issued_at`)
  SELECT 'KIS', `env`, `token`, `token_type`, `expires_at`, `issued_at` FROM `access_tokens`;
--> statement-breakpoint
DROP TABLE `access_tokens`;
--> statement-breakpoint
ALTER TABLE `access_tokens_new` RENAME TO `access_tokens`;

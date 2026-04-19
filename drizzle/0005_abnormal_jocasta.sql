-- credentials 테이블 PK를 env → account_id로 변경.
-- env는 일반 컬럼 + UNIQUE INDEX로 보존 (한 env당 한 행 보장).
-- account_id는 accounts.id 1:1 매핑.
--
-- 데이터 보존 절차:
--   1) credentials.env 매칭 account 없으면 자동 시드 (개발 초기 케이스)
--   2) 활성 계좌 없으면 첫 계좌 활성화 (single-active 불변식 시드)
--   3) 신규 테이블 __new_credentials 생성
--   4) 기존 credentials → 매칭 account_id로 복사
--   5) drop + rename + UNIQUE INDEX
--   6) lots/orders 의 account_id NULL/0 backfill

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- 기존 credentials.env 에 매칭되는 account 가 없으면 자동 시드.
INSERT INTO accounts (env, account_no_8, account_prod_cd, nickname, created_at, is_active, display_name)
SELECT
  c.env,
  '00000000',
  '01',
  '',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  0,
  NULL
FROM credentials c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.env = c.env
);
--> statement-breakpoint

-- 활성 계좌 없으면 첫 계좌 활성화.
UPDATE accounts SET is_active = 1
WHERE id = (SELECT MIN(id) FROM accounts)
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE is_active = 1);
--> statement-breakpoint

CREATE TABLE `__new_credentials` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`env` text NOT NULL,
	`payload` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

-- 각 env 별 매칭 account(active 우선)에 credentials 복사.
INSERT INTO `__new_credentials` (`account_id`, `env`, `payload`, `updated_at`)
SELECT
  (SELECT id FROM accounts a
    WHERE a.env = c.env
    ORDER BY a.is_active DESC, a.id ASC
    LIMIT 1),
  c.env,
  c.payload,
  c.updated_at
FROM credentials c
WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.env = c.env);
--> statement-breakpoint

DROP TABLE `credentials`;--> statement-breakpoint
ALTER TABLE `__new_credentials` RENAME TO `credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_env_uniq` ON `credentials` (`env`);--> statement-breakpoint

-- lots.account_id backfill — 0 또는 NULL을 활성 계좌로.
UPDATE lots SET account_id = (
  SELECT id FROM accounts WHERE is_active = 1 LIMIT 1
)
WHERE (account_id IS NULL OR account_id = 0)
  AND EXISTS (SELECT 1 FROM accounts WHERE is_active = 1);
--> statement-breakpoint

-- orders.account_id 동일 backfill.
UPDATE orders SET account_id = (
  SELECT id FROM accounts WHERE is_active = 1 LIMIT 1
)
WHERE (account_id IS NULL OR account_id = 0)
  AND EXISTS (SELECT 1 FROM accounts WHERE is_active = 1);

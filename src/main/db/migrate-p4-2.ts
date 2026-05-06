import { BROKERS } from '@shared/contracts';
import { sql } from 'drizzle-orm';
import type { EventLogger } from '../logging/event-logger';
import type { Db } from './client';

/**
 * Phase 4-2: cryptoAutoWatches → watchOrders(broker='UPBIT') 데이터 migration.
 *
 * idempotent — settings.phase_4_2_migrated_at 플래그로 부팅 시 1회만 실행. JSON snapshot 을
 * settings.phase_4_2_backup 에 보존하므로 P4-4 이전까지 source-of-truth 는 cryptoAutoWatches
 * 테이블 자체이며, 본 migration 결과는 dispatch / 통합 layer 의 forward compatibility 를 위한
 * 사전 INSERT.
 *
 * 안전 정책:
 *  - cryptoAutoConfigs 매칭 행 없으면 skip + audit log (silent default 금지).
 *  - watchOrders 의 broker/accountId/pdno 가 동일한 row 가 이미 존재하면 skip (재시도 안전).
 *  - 모든 INSERT 는 단일 transaction. 어느 한 row 라도 실패하면 rollback + 플래그 미설정.
 *
 * 매핑 규칙 (plan 4A 기준):
 *  - broker = 'UPBIT', accountId/market 그대로, side = 'BUY', source = 'CUSTOM',
 *    comparator = 'LTE', qtyOrAmountMode = 'AMOUNT', nth = null
 *  - amountKrw = Number(config.max_order_krw) (정수 변환, NaN 시 5000 fallback)
 *  - orderType = strategy.autoBuyOrderType 기본값 'LIMIT' (fallback)
 *  - targetPrice = 0 (UPBIT 자동감시는 entryConditionJson 기준 평가 — 본 컬럼은 미사용)
 *  - status / createdAt / updatedAt 그대로, executedAt = null
 *  - entryConditionJson / strategyJson / guardJson 그대로 복사 (P4-1 컬럼에 저장).
 *  - metadata = label (사용자 라벨 보존).
 */

const SETTING_KEY_MIGRATED_AT = 'phase_4_2_migrated_at';
const SETTING_KEY_BACKUP = 'phase_4_2_backup';

interface CryptoAutoWatchRow {
  id: number;
  account_id: number;
  exchange: string;
  market: string;
  label: string | null;
  status: string;
  entry_condition_json: string;
  strategy_json: string;
  guard_json: string | null;
  created_at: number;
  updated_at: number;
}

interface CryptoAutoConfigRow {
  account_id: number;
  exchange: string;
  market: string;
  max_order_krw: string;
}

export interface MigrateP42Result {
  alreadyMigrated: boolean;
  total: number;
  inserted: number;
  skippedNoConfig: number;
  skippedExisting: number;
}

function readSetting(db: Db, key: string): string | null {
  const row = db
    .all<{ value: string }>(sql.raw(`SELECT value FROM settings WHERE key = '${key}' LIMIT 1`))
    .at(0);
  return row?.value ?? null;
}

function writeSetting(db: Db, key: string, value: string): void {
  const now = Date.now();
  db.run(
    sql.raw(
      `INSERT INTO settings (key, value, updated_at) VALUES ('${key.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}', ${now})
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ),
  );
}

export function migrateCryptoAutoWatchesToWatchOrders(
  db: Db,
  logger?: EventLogger,
): MigrateP42Result {
  const flag = readSetting(db, SETTING_KEY_MIGRATED_AT);
  if (flag !== null) {
    return {
      alreadyMigrated: true,
      total: 0,
      inserted: 0,
      skippedNoConfig: 0,
      skippedExisting: 0,
    };
  }

  // cryptoAutoWatches 테이블이 누락된 환경 (fresh DB) 은 조용히 스킵 + 플래그 설정.
  let watches: CryptoAutoWatchRow[];
  try {
    watches = db.all<CryptoAutoWatchRow>(sql.raw('SELECT * FROM crypto_auto_watches'));
  } catch {
    writeSetting(db, SETTING_KEY_MIGRATED_AT, new Date().toISOString());
    return {
      alreadyMigrated: false,
      total: 0,
      inserted: 0,
      skippedNoConfig: 0,
      skippedExisting: 0,
    };
  }

  // backup snapshot — P4-4 이전까지 rollback 자료로 보존.
  writeSetting(db, SETTING_KEY_BACKUP, JSON.stringify(watches));

  let inserted = 0;
  let skippedNoConfig = 0;
  let skippedExisting = 0;

  const runMigration = (): void => {
    for (const watch of watches) {
      const config = db
        .all<CryptoAutoConfigRow>(
          sql.raw(
            `SELECT account_id, exchange, market, max_order_krw FROM crypto_auto_configs
             WHERE account_id = ${watch.account_id}
               AND exchange = '${watch.exchange.replace(/'/g, "''")}'
               AND market = '${watch.market.replace(/'/g, "''")}'
             LIMIT 1`,
          ),
        )
        .at(0);

      if (!config) {
        skippedNoConfig += 1;
        logger?.log({
          level: 'WARN',
          category: 'WATCH',
          message: 'phase-4-2.migration.skipped.no_config',
          payload: {
            accountId: watch.account_id,
            broker: BROKERS.UPBIT,
            pdno: watch.market,
            watchId: watch.id,
            status: watch.status,
          },
        });
        continue;
      }

      const exists = db
        .all<{ id: number }>(
          sql.raw(
            `SELECT id FROM watch_orders
             WHERE broker = '${BROKERS.UPBIT}'
               AND account_id = ${watch.account_id}
               AND pdno = '${watch.market.replace(/'/g, "''")}'
             LIMIT 1`,
          ),
        )
        .at(0);
      if (exists) {
        skippedExisting += 1;
        continue;
      }

      const amountKrw = Number(config.max_order_krw);
      const safeAmount = Number.isFinite(amountKrw) && amountKrw > 0 ? Math.floor(amountKrw) : 5000;
      const orderType = (() => {
        try {
          const strat = JSON.parse(watch.strategy_json) as { autoBuyOrderType?: string };
          return strat.autoBuyOrderType === 'MARKET' ? 'MARKET' : 'LIMIT';
        } catch {
          return 'LIMIT';
        }
      })();

      const escapedMarket = watch.market.replace(/'/g, "''");
      const escapedStatus = watch.status.replace(/'/g, "''");
      const escapedMetadata = (watch.label ?? '').replace(/'/g, "''");
      const escapedEntry = watch.entry_condition_json.replace(/'/g, "''");
      const escapedStrategy = watch.strategy_json.replace(/'/g, "''");
      const escapedGuard = watch.guard_json === null ? null : watch.guard_json.replace(/'/g, "''");
      const guardSql = escapedGuard === null ? 'NULL' : `'${escapedGuard}'`;
      const metadataSql = watch.label === null ? 'NULL' : `'${escapedMetadata}'`;

      db.run(
        sql.raw(
          `INSERT INTO watch_orders (
             broker, account_id, pdno, source, side, target_price, comparator, order_type,
             qty_or_amount_mode, qty, amount_krw, nth, source_ref_id, expires_at, status,
             last_failure_reason, metadata, created_at, updated_at, executed_at,
             entry_condition_json, strategy_json, guard_json
           ) VALUES (
             '${BROKERS.UPBIT}', ${watch.account_id}, '${escapedMarket}', 'CUSTOM', 'BUY', 0, 'LTE', '${orderType}',
             'AMOUNT', NULL, ${safeAmount}, NULL, NULL, NULL, '${escapedStatus}',
             NULL, ${metadataSql}, ${watch.created_at}, ${watch.updated_at}, NULL,
             '${escapedEntry}', '${escapedStrategy}', ${guardSql}
           )`,
        ),
      );
      inserted += 1;
      logger?.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'phase-4-2.migration.inserted',
        payload: {
          accountId: watch.account_id,
          broker: BROKERS.UPBIT,
          pdno: watch.market,
          watchId: watch.id,
          status: watch.status,
          amountKrw: safeAmount,
        },
      });
    }
    writeSetting(db, SETTING_KEY_MIGRATED_AT, new Date().toISOString());
  };

  // drizzle/better-sqlite3 transaction — INSERT 중 어느 하나라도 throw 시 rollback. 플래그도 미설정.
  db.transaction(() => {
    runMigration();
  });

  logger?.log({
    level: 'INFO',
    category: 'WATCH',
    message: 'phase-4-2.migration.completed',
    payload: { total: watches.length, inserted, skippedNoConfig, skippedExisting },
  });

  return {
    alreadyMigrated: false,
    total: watches.length,
    inserted,
    skippedNoConfig,
    skippedExisting,
  };
}

/** 테스트 용도 — 플래그/백업 reset 후 다시 실행 가능. */
export function resetP42MigrationFlagForTesting(db: Db): void {
  db.run(sql.raw(`DELETE FROM settings WHERE key = '${SETTING_KEY_MIGRATED_AT}'`));
  db.run(sql.raw(`DELETE FROM settings WHERE key = '${SETTING_KEY_BACKUP}'`));
}

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventLogEntry, EventLogger } from '../logging/event-logger';
import { bootstrapSchema } from './bootstrap-schema';
import { createTestDb, type Db } from './client';
import {
  migrateCryptoAutoWatchesToWatchOrders,
  resetP42MigrationFlagForTesting,
} from './migrate-p4-2';

interface CapturedLogger extends EventLogger {
  entries: EventLogEntry[];
}

function makeLogger(): CapturedLogger {
  const entries: EventLogEntry[] = [];
  return {
    entries,
    log: (entry) => entries.push(entry),
  };
}

function seedAccount(db: Db, accountId: number): void {
  const now = Date.now();
  db.run(
    sql.raw(
      `INSERT OR IGNORE INTO accounts (id, broker, env, account_no_8, account_prod_cd, nickname, created_at)
       VALUES (${accountId}, 'UPBIT', 'PROD', '${accountId}', '01', 'test', ${now})`,
    ),
  );
}

function seedWatchAndConfig(
  db: Db,
  opts: { accountId: number; market: string; status?: string; label?: string | null },
): void {
  const now = Date.now();
  const status = opts.status ?? 'PAUSED';
  const label = opts.label === undefined ? null : opts.label;
  const labelSql = label === null ? 'NULL' : `'${label}'`;
  const strategy = JSON.stringify({
    market: opts.market,
    autoBuyOrderType: 'LIMIT',
    rules: [],
  });
  const guard = JSON.stringify({ maxOrderKrw: '5000' });
  db.run(
    sql.raw(
      `INSERT INTO crypto_auto_watches (
         account_id, exchange, market, label, status, entry_condition_json, strategy_json, guard_json, created_at, updated_at
       ) VALUES (
         ${opts.accountId}, 'UPBIT', '${opts.market}', ${labelSql}, '${status}',
         '{"type":"immediate","price":null}', '${strategy.replace(/'/g, "''")}',
         '${guard.replace(/'/g, "''")}', ${now}, ${now}
       )`,
    ),
  );
}

function seedConfig(
  db: Db,
  opts: { accountId: number; market: string; maxOrderKrw?: string },
): void {
  const now = Date.now();
  const maxOrderKrw = opts.maxOrderKrw ?? '7500';
  db.run(
    sql.raw(
      `INSERT INTO crypto_auto_configs (
         account_id, exchange, market, mode, emergency_disabled, base_order_krw, max_order_krw,
         max_total_exposure_krw, min_order_total_krw, add_trigger_pct, take_profit_pct,
         max_open_lots, cooldown_ms, stale_cancel_cap, require_readonly_smoke,
         require_dry_run_history_before_live, last_dry_run_at, last_readonly_smoke_at,
         last_live_action_at, updated_at
       ) VALUES (
         ${opts.accountId}, 'UPBIT', '${opts.market}', 'disabled', 1, '5000', '${maxOrderKrw}',
         '50000', '5000', '0.03', '0.02', 3, 60000, 3, 1, 1, NULL, NULL, NULL, ${now}
       )`,
    ),
  );
}

function listUpbitWatchOrders(db: Db): Array<Record<string, unknown>> {
  return db.all(sql.raw("SELECT * FROM watch_orders WHERE broker = 'UPBIT'")) as Array<
    Record<string, unknown>
  >;
}

function readSetting(db: Db, key: string): string | null {
  const row = db
    .all<{ value: string }>(sql.raw(`SELECT value FROM settings WHERE key = '${key}'`))
    .at(0);
  return row?.value ?? null;
}

/**
 * Phase 4-4: bootstrapSchema 가 crypto_auto_watches 를 더 이상 생성하지 않음.
 * 본 migration 이 처리하는 source 테이블이라 테스트에서 직접 CREATE 한다.
 * (production 에서는 P4-3 이전 사용자의 기존 row 만 처리 — fresh DB 에선 자동 no-op.)
 */
function createLegacyCryptoAutoWatchesTable(db: Db): void {
  db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS crypto_auto_watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'UPBIT',
        market TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'PAUSED',
        entry_condition_json TEXT NOT NULL DEFAULT '{"type":"immediate","price":null}',
        strategy_json TEXT NOT NULL,
        guard_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
  );
  db.run(
    sql.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS crypto_auto_watches_account_market_uniq ON crypto_auto_watches(account_id, exchange, market)',
    ),
  );
}

describe('migrateCryptoAutoWatchesToWatchOrders (Phase 4-2)', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
    bootstrapSchema(db);
    createLegacyCryptoAutoWatchesTable(db);
  });

  afterEach(() => {
    resetP42MigrationFlagForTesting(db);
  });

  it('빈 cryptoAutoWatches → 플래그만 설정, watchOrders 미변경', () => {
    const result = migrateCryptoAutoWatchesToWatchOrders(db);
    expect(result.alreadyMigrated).toBe(false);
    expect(result.total).toBe(0);
    expect(result.inserted).toBe(0);
    expect(listUpbitWatchOrders(db)).toHaveLength(0);
    expect(readSetting(db, 'phase_4_2_migrated_at')).not.toBeNull();
  });

  it('1개 watch + matching config → watchOrders broker=UPBIT row 1개 INSERT', () => {
    seedAccount(db, 3);
    seedWatchAndConfig(db, { accountId: 3, market: 'KRW-BTC', label: 'BTC 자동' });
    seedConfig(db, { accountId: 3, market: 'KRW-BTC', maxOrderKrw: '7500' });

    const logger = makeLogger();
    const result = migrateCryptoAutoWatchesToWatchOrders(db, logger);

    expect(result.alreadyMigrated).toBe(false);
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.skippedNoConfig).toBe(0);

    const rows = listUpbitWatchOrders(db);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) throw new Error('row missing');
    expect(row.broker).toBe('UPBIT');
    expect(row.account_id).toBe(3);
    expect(row.pdno).toBe('KRW-BTC');
    expect(row.side).toBe('BUY');
    expect(row.source).toBe('CUSTOM');
    expect(row.qty_or_amount_mode).toBe('AMOUNT');
    expect(row.amount_krw).toBe(7500);
    expect(row.status).toBe('PAUSED');
    expect(row.metadata).toBe('BTC 자동');
    expect(row.entry_condition_json).toBe('{"type":"immediate","price":null}');
    expect(typeof row.strategy_json).toBe('string');
    expect(typeof row.guard_json).toBe('string');

    expect(logger.entries.some((e) => e.message === 'phase-4-2.migration.inserted')).toBe(true);
    expect(logger.entries.some((e) => e.message === 'phase-4-2.migration.completed')).toBe(true);
  });

  it('matching config 없는 watch → skip + audit log', () => {
    seedAccount(db, 3);
    seedWatchAndConfig(db, { accountId: 3, market: 'KRW-ETH' });
    // config 미생성

    const logger = makeLogger();
    const result = migrateCryptoAutoWatchesToWatchOrders(db, logger);

    expect(result.total).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.skippedNoConfig).toBe(1);
    expect(listUpbitWatchOrders(db)).toHaveLength(0);

    const skipLog = logger.entries.find(
      (e) => e.message === 'phase-4-2.migration.skipped.no_config',
    );
    expect(skipLog).toBeDefined();
    expect(skipLog?.level).toBe('WARN');
    expect(skipLog?.payload?.pdno).toBe('KRW-ETH');
  });

  it('재실행 시 idempotent — alreadyMigrated=true, watchOrders 추가 INSERT 없음', () => {
    seedAccount(db, 3);
    seedWatchAndConfig(db, { accountId: 3, market: 'KRW-BTC' });
    seedConfig(db, { accountId: 3, market: 'KRW-BTC' });

    const first = migrateCryptoAutoWatchesToWatchOrders(db);
    expect(first.inserted).toBe(1);

    const second = migrateCryptoAutoWatchesToWatchOrders(db);
    expect(second.alreadyMigrated).toBe(true);
    expect(second.inserted).toBe(0);

    expect(listUpbitWatchOrders(db)).toHaveLength(1); // 중복 INSERT 없음
  });

  it('이미 동일 (broker, accountId, pdno) 의 watchOrders 존재 → skipExisting', () => {
    seedAccount(db, 3);
    seedWatchAndConfig(db, { accountId: 3, market: 'KRW-BTC' });
    seedConfig(db, { accountId: 3, market: 'KRW-BTC' });

    const now = Date.now();
    db.run(
      sql.raw(
        `INSERT INTO watch_orders (
           broker, account_id, pdno, source, side, target_price, comparator, order_type,
           qty_or_amount_mode, amount_krw, status, created_at, updated_at
         ) VALUES (
           'UPBIT', 3, 'KRW-BTC', 'CUSTOM', 'BUY', 0, 'LTE', 'LIMIT',
           'AMOUNT', 5000, 'PAUSED', ${now}, ${now}
         )`,
      ),
    );

    const result = migrateCryptoAutoWatchesToWatchOrders(db);
    expect(result.skippedExisting).toBe(1);
    expect(result.inserted).toBe(0);
    expect(listUpbitWatchOrders(db)).toHaveLength(1);
  });

  it('cryptoAutoWatches 백업 snapshot 이 settings.phase_4_2_backup 에 저장됨', () => {
    seedAccount(db, 3);
    seedWatchAndConfig(db, { accountId: 3, market: 'KRW-BTC' });
    seedConfig(db, { accountId: 3, market: 'KRW-BTC' });

    migrateCryptoAutoWatchesToWatchOrders(db);

    const backup = readSetting(db, 'phase_4_2_backup');
    expect(backup).not.toBeNull();
    const parsed = JSON.parse(backup ?? '[]') as Array<{ market: string; account_id: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.market).toBe('KRW-BTC');
    expect(parsed[0]?.account_id).toBe(3);
  });
});

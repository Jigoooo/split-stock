import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function applyMigration0009(handle: Database.Database): void {
  const sqlFile = join(process.cwd(), 'drizzle', '0009_known_blue_shield.sql');
  const text = readFileSync(sqlFile, 'utf8');
  const statements = text
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    handle.prepare(stmt).run();
  }
}

function createOldProtectionLimitsDb(): Database.Database {
  const handle = new Database(':memory:');
  handle
    .prepare(
      `CREATE TABLE protection_limits (
        account_id INTEGER PRIMARY KEY,
        per_symbol_daily_max_buys INTEGER,
        daily_total_max_amount INTEGER,
        daily_total_max_count INTEGER,
        account_total_max_amount INTEGER,
        rate_guard_enabled INTEGER NOT NULL DEFAULT 0,
        rate_guard_window_seconds INTEGER DEFAULT 40,
        rate_guard_max_count INTEGER DEFAULT 5,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  return handle;
}

describe('migration 0009 — protection limit enabled flags', () => {
  it('기존 값이 있는 보호 한도만 enabled=true로 backfill한다', () => {
    const handle = createOldProtectionLimitsDb();
    handle
      .prepare(
        `INSERT INTO protection_limits (
          account_id,
          per_symbol_daily_max_buys,
          daily_total_max_amount,
          daily_total_max_count,
          account_total_max_amount,
          updated_at
        ) VALUES (1, 3, NULL, 10, NULL, ?)`,
      )
      .run(Date.now());

    applyMigration0009(handle);

    const row = handle
      .prepare(
        `SELECT
          per_symbol_daily_max_buys_enabled,
          daily_total_max_amount_enabled,
          daily_total_max_count_enabled,
          account_total_max_amount_enabled
        FROM protection_limits
        WHERE account_id = 1`,
      )
      .get() as Record<string, number>;

    expect(row.per_symbol_daily_max_buys_enabled).toBe(1);
    expect(row.daily_total_max_amount_enabled).toBe(0);
    expect(row.daily_total_max_count_enabled).toBe(1);
    expect(row.account_total_max_amount_enabled).toBe(0);
    handle.close();
  });
});

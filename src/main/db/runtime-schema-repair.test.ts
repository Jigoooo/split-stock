import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  repairAccountsRuntimeSchema,
  repairMarketContextRuntimeSchema,
} from './runtime-schema-repair';
import * as schema from './schema';

interface TableInfoRow {
  name: string;
}

describe('repairAccountsRuntimeSchema', () => {
  let handle: Database.Database | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('구버전 accounts 테이블에 broker/sort_order 컬럼을 보정한다', () => {
    handle = new Database(':memory:');
    handle.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        env TEXT NOT NULL,
        account_no_8 TEXT NOT NULL,
        account_prod_cd TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        display_name TEXT
      );
      INSERT INTO accounts (env, account_no_8, account_prod_cd, nickname, created_at, is_active)
      VALUES
        ('MOCK', '12345678', '01', '', 1000, 1),
        ('PROD', '99999999', '01', '', 2000, 0);
    `);
    const db = drizzle(handle, { schema });

    repairAccountsRuntimeSchema(db);

    const columns = handle.prepare('PRAGMA table_info(accounts)').all() as TableInfoRow[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['broker', 'sort_order']),
    );
    const rows = handle
      .prepare('SELECT broker, sort_order FROM accounts ORDER BY id')
      .all() as Array<{ broker: string; sort_order: number }>;
    expect(rows).toEqual([
      { broker: 'KIS', sort_order: 1 },
      { broker: 'KIS', sort_order: 2 },
    ]);
  });
});

describe('repairMarketContextRuntimeSchema', () => {
  let handle: Database.Database | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it('누락된 KRX/ECOS 캐시 테이블을 생성한다', () => {
    handle = new Database(':memory:');
    const db = drizzle(handle, { schema });

    repairMarketContextRuntimeSchema(db);

    const tables = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as TableInfoRow[];
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['ecos_series_cache', 'krx_base_info_cache', 'krx_daily_trade_cache']),
    );
  });
});

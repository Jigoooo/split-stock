import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

/**
 * 0005 SQL 파일을 직접 실행 — drizzle-migrator 의 hash 추적과 무관하게 0005 의
 * 데이터 보존 로직만 검증한다. 운영에선 migrator 가 0000~0005 를 순차 실행한다.
 */
function applyMigration0005(handle: Database.Database): void {
  const sqlFile = join(process.cwd(), 'drizzle', '0005_abnormal_jocasta.sql');
  const text = readFileSync(sqlFile, 'utf8');
  // drizzle 의 statement-breakpoint 분리자 기준으로 쪼갠 후 순차 실행.
  const statements = text
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    handle.prepare(stmt).run();
  }
}

/**
 * 마이그레이션 0005 — credentials PK env→account_id 전환의 데이터 보존 검증.
 *
 * 시나리오:
 *   - 0004 시점 스키마(env PK credentials) 를 수동 시드.
 *   - 0005 마이그레이션 실행.
 *   - 신규 스키마(account_id PK + UNIQUE INDEX env) 로 전환되고 데이터가 보존되는지 검증.
 */

function createOld0004Db(): Database.Database {
  const handle = new Database(':memory:');
  handle.pragma('foreign_keys = ON');
  // 0000~0004 까지 누적된 스키마를 수동 적용 (PK 변경 직전 상태).
  const ddl = [
    `CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      env TEXT NOT NULL,
      account_no_8 TEXT NOT NULL,
      account_prod_cd TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      display_name TEXT
    )`,
    `CREATE TABLE credentials (
      env TEXT PRIMARY KEY,
      payload BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      pdno TEXT NOT NULL,
      nth INTEGER NOT NULL,
      buy_price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      amount_krw INTEGER NOT NULL,
      status TEXT NOT NULL,
      bought_at INTEGER NOT NULL,
      sold_at INTEGER,
      sell_price INTEGER
    )`,
    `CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lot_id INTEGER,
      odno TEXT NOT NULL,
      org_no TEXT,
      pdno TEXT NOT NULL,
      side TEXT NOT NULL,
      division TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,
      status TEXT NOT NULL,
      placed_at INTEGER NOT NULL,
      filled_at INTEGER,
      cancel_count INTEGER NOT NULL DEFAULT 0
    )`,
  ];
  for (const stmt of ddl) handle.prepare(stmt).run();
  return handle;
}

describe('migration 0005 — credentials per-account', () => {
  it('단일 계좌 + 단일 credential — env→accountId 매핑으로 보존', () => {
    const handle = createOld0004Db();
    handle
      .prepare(
        `INSERT INTO accounts (env, account_no_8, account_prod_cd, nickname, created_at, is_active)
         VALUES ('MOCK', '12345678', '01', '', ?, 1)`,
      )
      .run(Date.now());
    const payload = Buffer.from('encrypted-bytes-mock', 'utf8');
    handle
      .prepare('INSERT INTO credentials (env, payload, updated_at) VALUES (?, ?, ?)')
      .run('MOCK', payload, Date.now());

    const db = drizzle(handle, { schema });
    applyMigration0005(handle);

    const rows = db.all<{
      account_id: number;
      env: string;
      payload: Buffer;
    }>(sql`SELECT account_id, env, payload FROM credentials`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.env).toBe('MOCK');
    expect(rows[0]?.account_id).toBe(1);
    expect(Buffer.from(rows[0]?.payload as Buffer).toString('utf8')).toBe('encrypted-bytes-mock');

    // UNIQUE INDEX 가 env 에 걸렸는지 — 동일 env 두 번째 insert 는 실패.
    expect(() =>
      handle
        .prepare(
          'INSERT INTO credentials (account_id, env, payload, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run(2, 'MOCK', Buffer.from('x', 'utf8'), Date.now()),
    ).toThrow();
    handle.close();
  });

  it('credentials 가 있는데 매칭 account 가 없으면 자동 시드', () => {
    const handle = createOld0004Db();
    // accounts 비어있음. credentials 만 PROD 1행.
    const payload = Buffer.from('prod-cred', 'utf8');
    handle
      .prepare('INSERT INTO credentials (env, payload, updated_at) VALUES (?, ?, ?)')
      .run('PROD', payload, Date.now());

    const db = drizzle(handle, { schema });
    applyMigration0005(handle);

    const accounts = db.all<{ id: number; env: string; is_active: number }>(
      sql`SELECT id, env, is_active FROM accounts`,
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.env).toBe('PROD');
    expect(accounts[0]?.is_active).toBe(1); // 자동 활성화

    const creds = db.all<{ account_id: number; env: string }>(
      sql`SELECT account_id, env FROM credentials`,
    );
    expect(creds[0]?.account_id).toBe(accounts[0]?.id);
    handle.close();
  });

  it('lots/orders.account_id 가 0 인 행은 활성 계좌로 backfill', () => {
    const handle = createOld0004Db();
    handle
      .prepare(
        `INSERT INTO accounts (env, account_no_8, account_prod_cd, nickname, created_at, is_active)
         VALUES ('MOCK', '12345678', '01', '', ?, 1)`,
      )
      .run(Date.now());
    handle
      .prepare(
        `INSERT INTO lots (account_id, pdno, nth, buy_price, qty, amount_krw, status, bought_at)
         VALUES (0, '005930', 1, 70000, 10, 700000, 'OPEN', ?)`,
      )
      .run(Date.now());
    handle
      .prepare(
        `INSERT INTO orders (account_id, odno, pdno, side, division, qty, price, status, placed_at)
         VALUES (0, 'O1', '005930', 'BUY', 'LIMIT', 10, 70000, 'PENDING', ?)`,
      )
      .run(Date.now());

    const db = drizzle(handle, { schema });
    applyMigration0005(handle);

    const lots = db.all<{ account_id: number }>(sql`SELECT account_id FROM lots`);
    const ordRows = db.all<{ account_id: number }>(sql`SELECT account_id FROM orders`);
    expect(lots[0]?.account_id).toBe(1);
    expect(ordRows[0]?.account_id).toBe(1);
    handle.close();
  });

  it('credentials 0개 + accounts 0개 — 신규 사용자 시나리오에서 무사 통과', () => {
    const handle = createOld0004Db();
    const db = drizzle(handle, { schema });
    expect(() => applyMigration0005(handle)).not.toThrow();

    const creds = db.all<{ account_id: number }>(sql`SELECT * FROM credentials`);
    expect(creds).toHaveLength(0);
    handle.close();
  });
});

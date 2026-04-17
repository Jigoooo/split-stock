import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type DbSchema = typeof schema;
export type Db = BetterSQLite3Database<DbSchema>;

let dbInstance: Db | null = null;
let sqliteHandle: Database.Database | null = null;

/**
 * 앱 영구 데이터 경로에 SQLite 파일 생성/오픈.
 * @param dbPath 명시 경로 (테스트는 ':memory:' 사용).
 */
export function openDb(dbPath: string): Db {
  if (dbInstance) return dbInstance;

  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  sqliteHandle = new Database(dbPath);
  sqliteHandle.pragma('journal_mode = WAL');
  sqliteHandle.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqliteHandle, { schema });
  return dbInstance;
}

/**
 * 마이그레이션 실행 — 앱 부팅 시 호출.
 * migrationsFolder는 번들 결과물에 포함된 경로를 지정.
 */
export function migrate(db: Db, migrationsFolder: string): void {
  drizzleMigrate(db, { migrationsFolder });
}

export function closeDb(): void {
  if (sqliteHandle) {
    sqliteHandle.close();
    sqliteHandle = null;
  }
  dbInstance = null;
}

/**
 * 인메모리 DB로 테스트용 인스턴스 생성 (싱글톤 우회).
 */
export function createTestDb(): Db {
  const handle = new Database(':memory:');
  handle.pragma('foreign_keys = ON');
  return drizzle(handle, { schema });
}

export function defaultDbPath(userDataDir: string): string {
  return join(userDataDir, 'split-stock.db');
}

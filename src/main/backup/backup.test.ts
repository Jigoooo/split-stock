import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import {
  BACKUP_SETTING_KEYS,
  clearImportedFlag,
  exportDatabase,
  importDatabase,
  needsCredentialsReentry,
} from './backup';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `split-stock-backup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function buildLogger(): EventLogger & { entries: Array<{ message: string; payload?: unknown }> } {
  const entries: Array<{ message: string; payload?: unknown }> = [];
  return {
    entries,
    log: (e) => entries.push({ message: e.message, payload: e.payload }),
  };
}

function setupSettings(): SettingsRepo {
  const db = createTestDb();
  bootstrapSchema(db);
  return new SettingsRepo(db);
}

describe('exportDatabase', () => {
  it('source → dest 복사 + sha256 반환 + backup.exported 로그', () => {
    const src = join(tmpDir, 'source.db');
    const dest = join(tmpDir, 'backup.db');
    writeFileSync(src, 'sample-db-content');
    const logger = buildLogger();

    const result = exportDatabase(src, dest, logger);
    expect(result.sha256).toHaveLength(64);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('sample-db-content');

    const log = logger.entries.find((e) => e.message === 'backup.exported');
    expect(log).toBeTruthy();
  });

  it('동일 파일을 두 번 export → sha256 결정성', () => {
    const src = join(tmpDir, 'source.db');
    writeFileSync(src, 'deterministic');
    const a = exportDatabase(src, join(tmpDir, 'a.db'), buildLogger());
    const b = exportDatabase(src, join(tmpDir, 'b.db'), buildLogger());
    expect(a.sha256).toBe(b.sha256);
  });

  it('source 미존재 → 명시적 에러', () => {
    expect(() =>
      exportDatabase(join(tmpDir, 'nope.db'), join(tmpDir, 'out.db'), buildLogger()),
    ).toThrow(/source DB not found/);
  });
});

describe('importDatabase', () => {
  it('기존 DB를 .backup-before-restore로 rename + 새 DB 복사 + manifest 생성', () => {
    const userDataPath = join(tmpDir, 'userData');
    mkdirSync(userDataPath);
    const existingDb = join(userDataPath, 'split-stock.db');
    writeFileSync(existingDb, 'OLD_DATA');
    const backupSrc = join(tmpDir, 'backup.db');
    writeFileSync(backupSrc, 'NEW_IMPORTED_DATA');

    const settings = setupSettings();
    const logger = buildLogger();
    const result = importDatabase({
      srcPath: backupSrc,
      userDataPath,
      settingsRepo: settings,
      logger,
      now: () => Date.UTC(2026, 3, 18),
    });

    expect(readFileSync(result.restoredPath, 'utf8')).toBe('NEW_IMPORTED_DATA');
    expect(existsSync(result.backupBeforeRestore)).toBe(true);
    expect(readFileSync(result.backupBeforeRestore, 'utf8')).toBe('OLD_DATA');
    expect(existsSync(result.manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.sha256).toBe(result.sha256);
    expect(manifest.sourcePath).toBe('backup.db');

    expect(settings.get(BACKUP_SETTING_KEYS.IMPORTED_FLAG)).toBe('true');
    expect(needsCredentialsReentry(settings)).toBe(true);

    const log = logger.entries.find((e) => e.message === 'backup.imported');
    expect(log).toBeTruthy();
  });

  it('기존 DB 없어도 import 성공 (신규 시나리오)', () => {
    const userDataPath = join(tmpDir, 'userData');
    mkdirSync(userDataPath);
    const backupSrc = join(tmpDir, 'backup.db');
    writeFileSync(backupSrc, 'FRESH');

    const settings = setupSettings();
    const result = importDatabase({
      srcPath: backupSrc,
      userDataPath,
      settingsRepo: settings,
      logger: buildLogger(),
      now: () => Date.UTC(2026, 3, 18),
    });
    expect(existsSync(result.restoredPath)).toBe(true);
    expect(existsSync(result.backupBeforeRestore)).toBe(false);
  });

  it('backup source 없으면 명시적 에러', () => {
    const settings = setupSettings();
    expect(() =>
      importDatabase({
        srcPath: join(tmpDir, 'nope.db'),
        userDataPath: tmpDir,
        settingsRepo: settings,
        logger: buildLogger(),
      }),
    ).toThrow(/backup file not found/);
  });
});

describe('needsCredentialsReentry / clearImportedFlag', () => {
  it('import 전엔 false, import 후엔 true, clear 후엔 false', () => {
    const settings = setupSettings();
    const logger = buildLogger();
    expect(needsCredentialsReentry(settings)).toBe(false);

    settings.set(BACKUP_SETTING_KEYS.IMPORTED_FLAG, 'true');
    expect(needsCredentialsReentry(settings)).toBe(true);

    clearImportedFlag(settings, logger);
    expect(needsCredentialsReentry(settings)).toBe(false);
    expect(logger.entries.some((e) => e.message === 'backup.imported_flag.cleared')).toBe(true);
  });
});

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';

export const BACKUP_SETTING_KEYS = {
  IMPORTED_FLAG: 'backup.importedFlag',
  LAST_IMPORT_AT: 'backup.lastImportAt',
} as const;

export interface BackupResult {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ImportResult {
  restoredPath: string;
  backupBeforeRestore: string;
  manifestPath: string;
  sha256: string;
}

function sha256File(path: string): string {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * DB 파일 내보내기 — 한 개 또는 두 개 경로에 동시 작성.
 * 각 파일 SHA-256 일치 검증.
 * 호출측이 dialog.showSaveDialog로 사용자 경로를 받아야 함.
 */
export function exportDatabase(
  srcPath: string,
  destPaths: string | string[],
  logger: EventLogger,
): BackupResult | BackupResult[] {
  if (!existsSync(srcPath)) {
    throw new Error(`source DB not found: ${srcPath}`);
  }

  // 단일 경로 vs 배열 경로 구분
  const pathArray = Array.isArray(destPaths) ? destPaths : [destPaths];
  const results: BackupResult[] = [];

  for (const destPath of pathArray) {
    copyFileSync(srcPath, destPath);
    const sha = sha256File(destPath);
    const bytes = readFileSync(destPath).byteLength;

    logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'backup.exported',
      payload: {
        destName: basename(destPath),
        sha256Prefix: sha.slice(0, 12),
        bytes,
      },
    });

    results.push({ path: destPath, sha256: sha, bytes });
  }

  // SHA-256 일치 검증 (2개 경로 이상)
  if (results.length > 1) {
    const firstSha = results[0]!.sha256;
    for (let i = 1; i < results.length; i++) {
      if (results[i]!.sha256 !== firstSha) {
        throw new Error(
          `backup verification failed: ${basename(results[0]!.path)} (${firstSha.slice(0, 12)}) ≠ ${basename(results[i]!.path)} (${results[i]!.sha256.slice(0, 12)})`,
        );
      }
    }
    logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'backup.duplicate_verified',
      payload: {
        paths: results.map((r) => basename(r.path)),
        sha256Prefix: firstSha.slice(0, 12),
      },
    });
  }

  return Array.isArray(destPaths) ? results : results[0]!;
}

export interface ImportDatabaseDeps {
  srcPath: string;
  userDataPath: string;
  settingsRepo: SettingsRepo;
  logger: EventLogger;
  now?: () => number;
}

/**
 * DB 파일 가져오기 — 복원 전 기존 파일을 .backup-before-restore.db로 이동 후 교체.
 * importedFlag를 settings에 기록 → UI가 credentials 재입력 안내 배너 표시.
 *
 * 보안 불변식:
 * - credentials BLOB은 safeStorage가 OS 사용자 키로 암호화 — 다른 머신/계정에서
 *   복호화 불가. 따라서 importedFlag를 통해 UI가 재입력을 안내한다.
 */
export function importDatabase(deps: ImportDatabaseDeps): ImportResult {
  if (!existsSync(deps.srcPath)) {
    throw new Error(`backup file not found: ${deps.srcPath}`);
  }
  const dbPath = join(deps.userDataPath, 'split-stock.db');
  const nowMs = deps.now ? deps.now() : Date.now();
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const beforeRestore = join(deps.userDataPath, `split-stock.backup-before-restore-${stamp}.db`);

  if (existsSync(dbPath)) {
    renameSync(dbPath, beforeRestore);
  }
  copyFileSync(deps.srcPath, dbPath);
  const sha = sha256File(dbPath);

  const manifestPath = join(deps.userDataPath, 'split-stock.import-manifest.json');
  const manifest = {
    importedAt: new Date(nowMs).toISOString(),
    sourcePath: basename(deps.srcPath),
    sourceDir: dirname(deps.srcPath),
    sha256: sha,
    backupBeforeRestore: basename(beforeRestore),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  deps.settingsRepo.set(BACKUP_SETTING_KEYS.IMPORTED_FLAG, 'true');
  deps.settingsRepo.set(BACKUP_SETTING_KEYS.LAST_IMPORT_AT, String(nowMs));

  deps.logger.log({
    level: 'WARN',
    category: 'SYS',
    message: 'backup.imported',
    payload: {
      sha256Prefix: sha.slice(0, 12),
      backupBeforeRestore: basename(beforeRestore),
    },
  });

  return {
    restoredPath: dbPath,
    backupBeforeRestore: beforeRestore,
    manifestPath,
    sha256: sha,
  };
}

/**
 * 복원 후 credentials 재입력이 필요한 상태인지 조회.
 * UI가 배너 표시/숨김 결정에 사용.
 */
export function needsCredentialsReentry(settingsRepo: SettingsRepo): boolean {
  return settingsRepo.get(BACKUP_SETTING_KEYS.IMPORTED_FLAG) === 'true';
}

/**
 * 사용자가 credentials 재입력을 완료했을 때 플래그 해제.
 * credentials-repo.saveCredentials 성공 후 호출 권장.
 */
export function clearImportedFlag(settingsRepo: SettingsRepo, logger: EventLogger): void {
  settingsRepo.delete(BACKUP_SETTING_KEYS.IMPORTED_FLAG);
  logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'backup.imported_flag.cleared',
  });
}

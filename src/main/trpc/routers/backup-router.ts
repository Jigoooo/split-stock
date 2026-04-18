import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { TRPCError } from '@trpc/server';
import {
  clearImportedFlag,
  exportDatabase,
  importDatabase,
  needsCredentialsReentry,
} from '../../backup/backup';
import { publicProcedure, router } from '../trpc-core';

// Electron dialog — CJS interop 회피용 lazy require
function electronDialog(): typeof import('electron').dialog {
  const req = createRequire(import.meta.url);
  const mod = req('electron') as { dialog: typeof import('electron').dialog };
  return mod.dialog;
}

function electronApp(): typeof import('electron').app {
  const req = createRequire(import.meta.url);
  const mod = req('electron') as { app: typeof import('electron').app };
  return mod.app;
}

export const backupRouter = router({
  needsCredentialsReentry: publicProcedure.query(({ ctx }) => ({
    needsReentry: needsCredentialsReentry(ctx.settingsRepo),
  })),

  clearImportedFlag: publicProcedure.mutation(({ ctx }) => {
    clearImportedFlag(ctx.settingsRepo, ctx.logger);
    return { ok: true as const };
  }),

  exportDatabase: publicProcedure.mutation(async ({ ctx }) => {
    const app = electronApp();
    const dialog = electronDialog();
    const defaultName = `split-stock-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const result = await dialog.showSaveDialog({
      title: 'DB 백업 파일 저장',
      defaultPath: defaultName,
      filters: [{ name: 'SQLite DB', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true as const };
    }
    const srcPath = join(app.getPath('userData'), 'split-stock.db');
    const backup = exportDatabase(srcPath, result.filePath, ctx.logger);
    return {
      canceled: false as const,
      path: backup.path,
      filename: basename(backup.path),
      sha256: backup.sha256,
      bytes: backup.bytes,
    };
  }),

  importDatabase: publicProcedure.mutation(async ({ ctx }) => {
    const app = electronApp();
    const dialog = electronDialog();
    const result = await dialog.showOpenDialog({
      title: 'DB 백업 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite DB', extensions: ['db'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const };
    }
    const srcPath = result.filePaths[0];
    if (!srcPath) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '파일 경로 누락' });
    }
    const r = importDatabase({
      srcPath,
      userDataPath: app.getPath('userData'),
      settingsRepo: ctx.settingsRepo,
      logger: ctx.logger,
    });
    return {
      canceled: false as const,
      backupBeforeRestore: basename(r.backupBeforeRestore),
      sha256: r.sha256,
      needsReentry: true,
      restartRequired: true,
    };
  }),

  /**
   * 복원 직후 호출 — better-sqlite3 handle 무효화 이슈 회피.
   * app.relaunch는 다음 tick에 새 프로세스를 띄우고 exit(0)으로 현재 프로세스 종료.
   */
  restartApp: publicProcedure.mutation(() => {
    const app = electronApp();
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return { ok: true as const };
  }),
});

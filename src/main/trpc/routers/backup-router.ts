import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  clearImportedFlag,
  exportDatabase,
  importDatabase,
  needsCredentialsReentry,
} from '../../backup/backup';
import { SETTING_KEYS } from '../../db/settings-repo';
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

    // 기본 경로 + 2중 백업 경로 (있으면) 동시 작성
    const duplicatePath = ctx.settingsRepo.get(SETTING_KEYS.BACKUP_DUPLICATE_PATH);
    const destPaths = duplicatePath ? [result.filePath, duplicatePath] : result.filePath;

    const backupResult = exportDatabase(srcPath, destPaths, ctx.logger);

    // 단일 경로와 다중 경로 모두 처리
    const results = Array.isArray(backupResult) ? backupResult : [backupResult];
    const primaryResult = results.length > 0 ? results[0] : null;

    if (!primaryResult) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'exportDatabase failed to return result',
      });
    }

    return {
      canceled: false as const,
      path: primaryResult.path,
      filename: basename(primaryResult.path),
      sha256: primaryResult.sha256,
      bytes: primaryResult.bytes,
      duplicateCount: results.length,
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

  /**
   * 2중 백업 외부 드라이브 경로 조회
   */
  getDuplicatePath: publicProcedure.query(({ ctx }) => {
    const path = ctx.settingsRepo.get(SETTING_KEYS.BACKUP_DUPLICATE_PATH);
    return { path: path ?? null };
  }),

  /**
   * 2중 백업 외부 드라이브 경로 설정
   */
  setDuplicatePath: publicProcedure
    .input(
      z.object({
        path: z.string().min(1, '경로는 필수입니다'),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!existsSync(input.path)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `경로가 존재하지 않습니다: ${input.path}`,
        });
      }
      ctx.settingsRepo.set(SETTING_KEYS.BACKUP_DUPLICATE_PATH, input.path);
      ctx.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'backup.duplicate_path.set',
        payload: { path: input.path },
      });
      return { ok: true as const, path: input.path };
    }),

  /**
   * 폴더 선택 dialog 표시 후 경로 반환
   */
  pickDuplicateFolder: publicProcedure.mutation(async ({ ctx: _ctx }) => {
    const dialog = electronDialog();
    const result = await dialog.showOpenDialog({
      title: '2중 백업 폴더 선택',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const };
    }
    const selectedPath = result.filePaths[0];
    if (!selectedPath) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '폴더 경로 누락',
      });
    }
    return {
      canceled: false as const,
      path: selectedPath,
    };
  }),
});

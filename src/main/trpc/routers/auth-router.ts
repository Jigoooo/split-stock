import { AppEnvSchema, CredentialsSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { clearImportedFlag, needsCredentialsReentry } from '../../backup/backup';
import { SETTING_KEYS } from '../../db/settings-repo';
import { publicProcedure, router } from '../trpc-core';

export const authRouter = router({
  /**
   * 현재 활성 환경(MOCK/PROD) 조회.
   */
  getEnv: publicProcedure.query(({ ctx }) => ({
    env: ctx.currentEnv,
  })),

  /**
   * 활성 환경 전환. 저장된 자격증명이 없으면 에러.
   * 성공 시 lastActiveEnv 영속 → 재시작 후 자동 복원.
   */
  setEnv: publicProcedure.input(AppEnvSchema).mutation(({ ctx, input }) => {
    const cred = ctx.credentialsRepo.loadCredentials(input);
    if (cred.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `자격증명 로드 실패: ${cred.error.kind}`,
      });
    }
    if (!cred.value) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `${input} 환경의 자격증명이 저장되어 있지 않습니다`,
      });
    }
    const prev = ctx.currentEnv;
    ctx.setCurrentEnv(input);
    ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, input);
    ctx.logger.log({
      level: input === 'PROD' ? 'WARN' : 'INFO',
      category: 'AUTH',
      message: input === 'PROD' ? 'env.switch-to-prod' : 'env.switch-to-mock',
      payload: { from: prev, to: input },
    });
    // 로그인 직후 종목 마스터가 비어있거나 24h 초과면 백그라운드 동기화.
    ctx.stockMasterSync.syncIfStale().then((r) => {
      if (r.isErr()) {
        ctx.logger.log({
          level: 'WARN',
          category: 'SYS',
          message: 'stockMaster.sync.failed',
          payload: { kind: r.error.kind, msg: r.error.msg },
        });
        return;
      }
      if (r.value) {
        ctx.logger.log({
          level: 'INFO',
          category: 'SYS',
          message: 'stockMaster.sync.ok',
          payload: { total: r.value.total, kospi: r.value.kospi, kosdaq: r.value.kosdaq },
        });
      }
    });
    return { env: input };
  }),

  /**
   * 로그아웃 — 현재 환경 비활성화. 자격증명은 기본 보존(재로그인 시 재입력 불필요).
   * clearStored:true로 호출하면 해당 env 자격증명도 DB에서 삭제.
   */
  logout: publicProcedure
    .input(z.object({ clearStored: z.boolean().default(false) }).default({ clearStored: false }))
    .mutation(({ ctx, input }) => {
      const current = ctx.currentEnv;
      if (current && input.clearStored) {
        const r = ctx.credentialsRepo.clearCredentials(current);
        if (r.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '자격증명 삭제 실패',
          });
        }
      }
      ctx.setCurrentEnv(null);
      ctx.settingsRepo.delete(SETTING_KEYS.LAST_ACTIVE_ENV);
      return { ok: true as const };
    }),

  /**
   * 자격증명 저장 — safeStorage 암호화 후 SQLite BLOB.
   * 성공 시 해당 env로 자동 전환하지 않음. 명시적 setEnv 필요.
   */
  setCredentials: publicProcedure.input(CredentialsSchema).mutation(({ ctx, input }) => {
    const r = ctx.credentialsRepo.saveCredentials(input);
    if (r.isErr()) {
      const kind = r.error.kind;
      throw new TRPCError({
        code: kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: `자격증명 저장 실패: ${kind}`,
      });
    }
    // 복원 직후 재입력이라면 안내 플래그 자동 해제.
    if (needsCredentialsReentry(ctx.settingsRepo)) {
      clearImportedFlag(ctx.settingsRepo, ctx.logger);
    }
    return { ok: true as const };
  }),

  /**
   * 저장된 자격증명이 있는 env 리스트 (마스킹된 미리보기).
   */
  listStored: publicProcedure.query(({ ctx }) => {
    const envs: Array<'MOCK' | 'PROD'> = ['MOCK', 'PROD'];
    const result: Array<{ env: 'MOCK' | 'PROD'; accountNo8: string }> = [];
    for (const env of envs) {
      const r = ctx.credentialsRepo.loadCredentials(env);
      if (r.isOk() && r.value) {
        result.push({ env, accountNo8: r.value.accountNo8 });
      }
    }
    return { entries: result };
  }),

  /**
   * 특정 env의 자격증명 삭제.
   */
  clearCredentials: publicProcedure
    .input(z.object({ env: AppEnvSchema }))
    .mutation(({ ctx, input }) => {
      const r = ctx.credentialsRepo.clearCredentials(input.env);
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '자격증명 삭제 실패',
        });
      }
      if (ctx.currentEnv === input.env) ctx.setCurrentEnv(null);
      return { ok: true as const };
    }),
});

import { AppEnvSchema, CredentialsSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
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
    ctx.setCurrentEnv(input);
    return { env: input };
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

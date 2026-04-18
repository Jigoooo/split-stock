import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { inquireDailyChart, inquirePrice } from '../../kis/domestic-stock';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

export const marketRouter = router({
  searchStock: publicProcedure
    .input(
      z.object({
        term: z.string().min(1).max(32),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) => ({
      entries: ctx.stockMasterRepo.search(input.term, input.limit),
    })),

  getDailyChart: authedProcedure
    .input(
      z.object({
        code: z.string().regex(/^\d{6}$/),
        months: z.number().int().min(1).max(24).default(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const to = new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - input.months);
      const r = await inquireDailyChart(
        {
          http: ctx.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
        },
        { code: input.code, from, to },
      );
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `일봉 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return { candles: r.value };
    }),

  getPrice: authedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const r = await inquirePrice(
        {
          http: ctx.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
        },
        input.code,
      );
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `현재가 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return r.value;
    }),
});

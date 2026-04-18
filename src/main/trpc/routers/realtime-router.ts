import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { authedProcedure, router } from '../trpc-core';

const PdnoSchema = z.object({ pdno: z.string().regex(/^\d{6}$/) });
const TopicSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/),
  topic: z.enum(['tick', 'orderbook']),
});

export const realtimeRouter = router({
  start: authedProcedure.mutation(async ({ ctx }) => {
    const env = ctx.currentEnv;
    if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
    if (!ctx.realtime) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '실시간 서비스가 초기화되지 않음',
      });
    }
    const credResult = ctx.credentialsRepo.loadCredentials(env);
    if (credResult.isErr() || !credResult.value) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
    }
    const cred = credResult.value;
    const r = await ctx.realtime.start(cred.appKey, cred.appSecret);
    if (!r.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `실시간 시작 실패: ${r.reason ?? ''}`,
      });
    }
    return { ok: true as const };
  }),

  stop: authedProcedure.mutation(({ ctx }) => {
    ctx.realtime?.stop();
    return { ok: true as const };
  }),

  status: authedProcedure.query(({ ctx }) => ({
    started: ctx.realtime?.isStarted() ?? false,
    watched: ctx.realtime?.getWatched() ?? [],
  })),

  watch: authedProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    if (!ctx.realtime) return { ok: false as const };
    ctx.realtime.watch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  unwatch: authedProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    ctx.realtime?.unwatch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  getLatestTick: authedProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    tick: ctx.bus?.getLatestTick(input.pdno) ?? null,
  })),

  getLatestOrderbook: authedProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    orderbook: ctx.bus?.getLatestOrderbook(input.pdno) ?? null,
  })),
});

import { z } from 'zod';
import { SENTRY_KEYS } from '../../monitoring/sentry';
import { publicProcedure, router } from '../trpc-core';

export const monitoringRouter = router({
  getDsn: publicProcedure.query(({ ctx }) => {
    const dsn = ctx.settingsRepo.get(SENTRY_KEYS.DSN);
    const enableInDev = ctx.settingsRepo.get(SENTRY_KEYS.ENABLE_IN_DEV) === 'true';
    return { dsn, enableInDev };
  }),

  setDsn: publicProcedure
    .input(
      z.object({
        dsn: z
          .string()
          .max(500)
          .refine((s) => s === '' || /^https?:\/\//i.test(s), 'DSN은 빈 문자열 또는 http(s) URL'),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.dsn === '') {
        ctx.settingsRepo.delete(SENTRY_KEYS.DSN);
      } else {
        ctx.settingsRepo.set(SENTRY_KEYS.DSN, input.dsn);
      }
      ctx.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'sentry.dsn.updated',
        payload: { cleared: input.dsn === '' },
      });
      return { ok: true as const };
    }),

  clearDsn: publicProcedure.mutation(({ ctx }) => {
    ctx.settingsRepo.delete(SENTRY_KEYS.DSN);
    return { ok: true as const };
  }),

  setEnableInDev: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      if (input.enabled) {
        ctx.settingsRepo.set(SENTRY_KEYS.ENABLE_IN_DEV, 'true');
      } else {
        ctx.settingsRepo.delete(SENTRY_KEYS.ENABLE_IN_DEV);
      }
      return { ok: true as const };
    }),

  /**
   * WS 슬롯 사용 현황 조회 — 자동감시·시세 동시 다종목 등록 시 capacity 초과로
   * REST 폴링 강등된 종목이 얼마나 되는지 사용자가 reports 페이지에서 한 번에 확인.
   */
  getRealtimeStats: publicProcedure.query(({ ctx }) => {
    const realtime = ctx.realtime;
    if (!realtime) {
      return { capacity: 0, wsCount: 0, restFallbackCount: 0, total: 0 };
    }
    const subs = realtime.getActiveSubscriptions();
    const capacity = realtime.getSessionCapacity();
    let wsCount = 0;
    let restFallbackCount = 0;
    for (const s of subs) {
      // BOTH 는 슬롯 2 소비 — capacity 비교 시 감안.
      const cost = s.kind === 'BOTH' ? 2 : 1;
      if (s.isWS) wsCount += cost;
      else restFallbackCount += cost;
    }
    return { capacity, wsCount, restFallbackCount, total: subs.length };
  }),
});

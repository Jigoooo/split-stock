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
});

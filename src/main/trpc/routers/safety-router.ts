import { z } from 'zod';
import { publicProcedure, router } from '../trpc-core';

export const safetyRouter = router({
  getState: publicProcedure.query(({ ctx }) => ctx.safety.getSnapshot()),

  setMaster: publicProcedure
    .input(z.object({ on: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.safety.setMaster(input.on)),

  toggleSymbol: publicProcedure
    .input(z.object({ pdno: z.string().regex(/^\d{6}$/), on: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.safety.toggleSymbol(input.pdno, input.on)),

  triggerKillSwitch: publicProcedure
    .input(z.object({ reason: z.string().default('사용자 단축키') }))
    .mutation(({ ctx, input }) => ctx.safety.triggerKillSwitch(input.reason)),

  clearErrorLock: publicProcedure.mutation(({ ctx }) => ctx.safety.clearErrorLock()),
});

import { StrategyProfileSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc-core';

const PdnoSchema = z.object({
  pdno: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
});

const PresetNameSchema = z.object({ name: z.string().min(1).max(50) });

export const strategyRouter = router({
  getActive: publicProcedure.input(PdnoSchema).query(({ ctx, input }) => {
    const r = ctx.strategyRepo.getActive(input.pdno);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `전략 로드 실패: ${r.error.kind}`,
      });
    }
    return { profile: r.value };
  }),

  setActive: publicProcedure
    .input(PdnoSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const r = ctx.strategyRepo.setActive(input.pdno, input.profile);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: `전략 저장 실패: ${r.error.kind}`,
        });
      }
      return { ok: true as const };
    }),

  clearActive: publicProcedure.input(PdnoSchema).mutation(({ ctx, input }) => {
    ctx.strategyRepo.clearActive(input.pdno);
    return { ok: true as const };
  }),

  listPresets: publicProcedure.query(({ ctx }) => ({
    presets: ctx.strategyRepo.listPresets(),
  })),

  savePreset: publicProcedure
    .input(PresetNameSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const r = ctx.strategyRepo.savePreset(input.name, input.profile);
      if (r.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `프리셋 저장 실패: ${r.error.kind}` });
      }
      return { ok: true as const };
    }),

  deletePreset: publicProcedure.input(PresetNameSchema).mutation(({ ctx, input }) => {
    ctx.strategyRepo.deletePreset(input.name);
    return { ok: true as const };
  }),
});

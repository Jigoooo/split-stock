import { StrategyProfileSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { resolveAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive().optional();

const ActiveSelectorSchema = z.object({
  pdno: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
  accountId: AccountIdField,
});

const PresetNameSchema = z.object({
  name: z.string().min(1).max(50),
  accountId: AccountIdField,
});

export const strategyRouter = router({
  getActive: publicProcedure.input(ActiveSelectorSchema).query(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    const r = ctx.strategyRepo.getActive(accountId, input.pdno);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `전략 로드 실패: ${r.error.kind}`,
      });
    }
    return { profile: r.value };
  }),

  setActive: publicProcedure
    .input(ActiveSelectorSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const r = ctx.strategyRepo.setActive(accountId, input.pdno, input.profile);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: `전략 저장 실패: ${r.error.kind}`,
        });
      }
      return { ok: true as const };
    }),

  clearActive: publicProcedure.input(ActiveSelectorSchema).mutation(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    ctx.strategyRepo.clearActive(accountId, input.pdno);
    return { ok: true as const };
  }),

  listPresets: publicProcedure
    .input(z.object({ accountId: AccountIdField }).optional())
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      return { presets: ctx.strategyRepo.listPresets(accountId) };
    }),

  savePreset: publicProcedure
    .input(PresetNameSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const r = ctx.strategyRepo.savePreset(accountId, input.name, input.profile);
      if (r.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `프리셋 저장 실패: ${r.error.kind}` });
      }
      return { ok: true as const };
    }),

  deletePreset: publicProcedure.input(PresetNameSchema).mutation(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    ctx.strategyRepo.deletePreset(accountId, input.name);
    return { ok: true as const };
  }),
});

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { requireAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();

const ProtectionLimitsInputSchema = z.object({
  accountId: AccountIdField,
  perSymbolDailyMaxBuys: z.number().int().positive().nullable().optional(),
  dailyTotalMaxAmount: z.number().int().positive().nullable().optional(),
  dailyTotalMaxCount: z.number().int().positive().nullable().optional(),
  accountTotalMaxAmount: z.number().int().positive().nullable().optional(),
  rateGuardEnabled: z.boolean().optional(),
  rateGuardWindowSeconds: z.number().int().positive().nullable().optional(),
  rateGuardMaxCount: z.number().int().positive().nullable().optional(),
});

/**
 * 자동매매 보호 한도 라우터.
 * get/set 모두 accountId 명시 필수 (requireAccountId).
 */
export const protectionRouter = router({
  /**
   * 보호 한도 조회 — NULL 행이면 미설정 상태로 null 반환.
   */
  get: publicProcedure.input(z.object({ accountId: AccountIdField })).query(({ ctx, input }) => {
    const accountId = requireAccountId(input);
    const r = ctx.protectionLimitsRepo.get(accountId);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `보호 한도 조회 실패: ${r.error.kind}`,
      });
    }
    return { limits: r.value };
  }),

  /**
   * 보호 한도 저장 (upsert) — accountId 명시 필수.
   */
  set: publicProcedure.input(ProtectionLimitsInputSchema).mutation(({ ctx, input }) => {
    const accountId = requireAccountId(input);
    const r = ctx.protectionLimitsRepo.upsert(accountId, {
      perSymbolDailyMaxBuys: input.perSymbolDailyMaxBuys ?? null,
      dailyTotalMaxAmount: input.dailyTotalMaxAmount ?? null,
      dailyTotalMaxCount: input.dailyTotalMaxCount ?? null,
      accountTotalMaxAmount: input.accountTotalMaxAmount ?? null,
      rateGuardEnabled: input.rateGuardEnabled ?? false,
      rateGuardWindowSeconds: input.rateGuardWindowSeconds ?? null,
      rateGuardMaxCount: input.rateGuardMaxCount ?? null,
    });
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `보호 한도 저장 실패: ${r.error.kind}`,
      });
    }
    return { limits: r.value };
  }),
});

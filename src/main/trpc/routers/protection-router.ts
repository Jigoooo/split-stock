import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { SetProtectionLimitsInput } from '../../safety/protection-limits-repo';
import { requireAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();

const ProtectionLimitsInputSchema = z.object({
  accountId: AccountIdField,
  perSymbolDailyMaxBuysEnabled: z.boolean().optional(),
  perSymbolDailyMaxBuys: z.number().int().positive().nullable().optional(),
  dailyTotalMaxAmountEnabled: z.boolean().optional(),
  dailyTotalMaxAmount: z.number().int().positive().nullable().optional(),
  dailyTotalMaxCountEnabled: z.boolean().optional(),
  dailyTotalMaxCount: z.number().int().positive().nullable().optional(),
  accountTotalMaxAmountEnabled: z.boolean().optional(),
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
    const next: SetProtectionLimitsInput = {
      perSymbolDailyMaxBuys: input.perSymbolDailyMaxBuys ?? null,
      dailyTotalMaxAmount: input.dailyTotalMaxAmount ?? null,
      dailyTotalMaxCount: input.dailyTotalMaxCount ?? null,
      accountTotalMaxAmount: input.accountTotalMaxAmount ?? null,
    };
    if (input.perSymbolDailyMaxBuysEnabled !== undefined) {
      next.perSymbolDailyMaxBuysEnabled = input.perSymbolDailyMaxBuysEnabled;
    }
    if (input.dailyTotalMaxAmountEnabled !== undefined) {
      next.dailyTotalMaxAmountEnabled = input.dailyTotalMaxAmountEnabled;
    }
    if (input.dailyTotalMaxCountEnabled !== undefined) {
      next.dailyTotalMaxCountEnabled = input.dailyTotalMaxCountEnabled;
    }
    if (input.accountTotalMaxAmountEnabled !== undefined) {
      next.accountTotalMaxAmountEnabled = input.accountTotalMaxAmountEnabled;
    }
    if (input.rateGuardEnabled !== undefined) next.rateGuardEnabled = input.rateGuardEnabled;
    if (input.rateGuardWindowSeconds !== undefined) {
      next.rateGuardWindowSeconds = input.rateGuardWindowSeconds;
    }
    if (input.rateGuardMaxCount !== undefined) next.rateGuardMaxCount = input.rateGuardMaxCount;

    const r = ctx.protectionLimitsRepo.upsert(accountId, next);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `보호 한도 저장 실패: ${r.error.kind}`,
      });
    }
    return { limits: r.value };
  }),
});

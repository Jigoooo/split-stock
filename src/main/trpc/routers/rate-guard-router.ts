import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();

/**
 * 호출자 활성 계좌와 input.accountId 일치 강제.
 */
function requireActiveAccountMatch(activeAccountId: number | null, inputAccountId: number): void {
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다.',
    });
  }
  if (activeAccountId !== inputAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌의 rate-guard 설정을 조작할 수 없습니다.',
    });
  }
}

export const rateGuardRouter = router({
  /**
   * rate-guard 설정 조회.
   */
  getSettings: publicProcedure
    .input(z.object({ accountId: AccountIdField }))
    .query(({ ctx, input }) => {
      requireActiveAccountMatch(ctx.activeAccountId, input.accountId);
      return ctx.rateGuardRepo.getSettings(input.accountId);
    }),

  /**
   * rate-guard 설정 갱신.
   */
  updateSettings: publicProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        enabled: z.boolean(),
        windowSeconds: z.number().int().min(1).max(3600),
        maxCount: z.number().int().min(1).max(100),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireActiveAccountMatch(ctx.activeAccountId, input.accountId);
      ctx.rateGuardRepo.updateSettings(
        input.accountId,
        input.enabled,
        input.windowSeconds,
        input.maxCount,
      );
      return { ok: true as const };
    }),
});

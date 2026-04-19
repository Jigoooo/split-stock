import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();
const SideSchema = z.enum(['BUY', 'SELL']);
const SlotSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const MinuteSchema = z.number().int().min(0).max(1439);

/**
 * 호출자 활성 계좌와 input.accountId 일치 강제.
 * 다른 계좌의 시간대를 조작할 수 없도록 차단.
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
      message: '다른 계좌의 시간대를 조작할 수 없습니다.',
    });
  }
}

export const tradingWindowsRouter = router({
  /**
   * 계좌의 매매 시간대 슬롯 목록 조회.
   */
  list: publicProcedure.input(z.object({ accountId: AccountIdField })).query(({ ctx, input }) => {
    requireActiveAccountMatch(ctx.activeAccountId, input.accountId);
    const windows = ctx.timeWindowRepo.list(input.accountId);
    return { windows };
  }),

  /**
   * 슬롯 upsert — 없으면 생성, 있으면 갱신.
   */
  upsert: publicProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        side: SideSchema,
        slot: SlotSchema,
        enabled: z.boolean(),
        startMinute: MinuteSchema,
        endMinute: MinuteSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      requireActiveAccountMatch(ctx.activeAccountId, input.accountId);
      ctx.timeWindowRepo.upsert(
        input.accountId,
        input.side,
        input.slot,
        input.enabled,
        input.startMinute,
        input.endMinute,
      );
      return { ok: true as const };
    }),

  /**
   * 슬롯 삭제.
   */
  delete: publicProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        side: SideSchema,
        slot: SlotSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      requireActiveAccountMatch(ctx.activeAccountId, input.accountId);
      ctx.timeWindowRepo.delete(input.accountId, input.side, input.slot);
      return { ok: true as const };
    }),
});

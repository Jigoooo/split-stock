import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { resolveAccountId } from '../router-helpers';
import { router, runtimeProcedure } from '../trpc-core';

const MarketSchema = z.string().regex(/^[A-Z]{3,5}-[A-Z0-9]{1,10}$/);

/**
 * 코인(UPBIT) 미체결 자동취소 활성 감시 목록 라우터. (RALPLAN P6 A4)
 *
 * 설정 자체(enabled/timeoutMin/maxRetries)는 stock pendingCancel 라우터와 공유 — 별도 설정 router 없음.
 * 본 라우터는 cryptoPendingOrderWatcher 인스턴스의 활성 항목 노출/해제 전용.
 */
export const cryptoPendingCancelRouter = router({
  listActive: runtimeProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => {
      if (!ctx.cryptoPendingOrderWatcher) return { items: [] };
      const activeAccountId = resolveAccountId(ctx, input ?? {});
      const all = ctx.cryptoPendingOrderWatcher.listActive();
      const filtered = all.filter(
        (e) => e.accountId === undefined || e.accountId === activeAccountId,
      );
      return { items: filtered };
    }),

  unregister: runtimeProcedure
    .input(
      z.object({
        market: MarketSchema,
        side: z.enum(['BUY', 'SELL']),
        nth: z.number().int().positive(),
        accountId: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.cryptoPendingOrderWatcher) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'cryptoPendingOrderWatcher가 초기화되지 않음',
        });
      }
      if (ctx.activeAccountId !== null && input.accountId !== ctx.activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌의 코인 미체결 감시 항목은 해제할 수 없습니다.',
        });
      }
      const all = ctx.cryptoPendingOrderWatcher.listActive();
      const found = all.find(
        (e) =>
          e.pdno === input.market &&
          e.side === input.side &&
          e.nth === input.nth &&
          (e.accountId === undefined || e.accountId === input.accountId),
      );
      if (!found) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 코인 미체결 감시 항목을 찾을 수 없습니다.',
        });
      }
      ctx.cryptoPendingOrderWatcher.cancel({
        pdno: input.market,
        side: input.side,
        nth: input.nth,
      });
      return { ok: true as const };
    }),
});

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { WatchOrderInputSchema } from '../../trading/watch-engine';
import { authedProcedure, router } from '../trpc-core';

const ListInputSchema = z.object({
  status: z.enum(['WATCHING', 'EXECUTED', 'FAILED', 'EXPIRED', 'CANCELLED']).optional(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).optional(),
  accountId: z.number().int().positive().optional(),
});

/**
 * 통합 자동감시주문 라우터.
 * - list: 4탭 화면(현황/실행내역/실패/히스토리)에서 status별 필터링
 * - cancel: WATCHING 항목 취소
 * - create: CUSTOM source용 신규 등록 (Wave 2 폼이 호출)
 *
 * BOOSTER/PREBUY source는 본 라우터로 직접 등록하지 않고
 * BoosterWatcher/PrebuyWatcher 어댑터를 통해 들어온다.
 */
export const watchRouter = router({
  list: authedProcedure.input(ListInputSchema).query(({ ctx, input }) => {
    if (!ctx.watchEngine) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'watchEngine이 초기화되지 않음',
      });
    }
    return { orders: ctx.watchEngine.list(input) };
  }),

  cancel: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const r = ctx.watchEngine.cancel(input.id);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `취소 실패: ${r.error.kind}`,
        });
      }
      return { ok: true as const };
    }),

  create: authedProcedure.input(WatchOrderInputSchema).mutation(({ ctx, input }) => {
    if (!ctx.watchEngine) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'watchEngine이 초기화되지 않음',
      });
    }
    const r = ctx.watchEngine.register(input);
    if (r.isErr()) {
      throw new TRPCError({
        code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: `등록 실패: ${r.error.kind}`,
      });
    }
    return { order: r.value };
  }),
});

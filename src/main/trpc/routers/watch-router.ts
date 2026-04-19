import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { watchOrders } from '../../db/schema';
import { WatchOrderInputSchema } from '../../trading/watch-engine';
import { authedProcedure, router } from '../trpc-core';

const ListInputSchema = z.object({
  status: z.enum(['WATCHING', 'EXECUTED', 'FAILED', 'EXPIRED', 'CANCELLED']).optional(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).optional(),
  accountId: z.number().int().positive().optional(),
});

/**
 * 활성 계좌 강제 — null 이면 PRECONDITION_FAILED.
 * 다른 helper(`router-helpers.ts`)와 동일한 에러 코드/메시지 패턴.
 */
function ensureActiveAccountId(activeAccountId: number | null): number {
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다. 자격증명을 먼저 등록하세요.',
    });
  }
  return activeAccountId;
}

/**
 * 통합 자동감시주문 라우터.
 * - list: 4탭 화면(현황/실행내역/실패/히스토리)에서 status별 필터링
 * - cancel: WATCHING 항목 취소 — 활성 계좌 소유 row만 가능
 * - create: CUSTOM source용 신규 등록 — 활성 계좌 한정 (Wave 2 폼이 호출)
 *
 * 보안 가드:
 * - 모든 작업은 `ctx.activeAccountId` 한정. 다른 계좌의 watch_orders row는
 *   조회/취소/생성 모두 거부 (FORBIDDEN / NOT_FOUND).
 * - BOOSTER/PREBUY source는 본 라우터로 직접 등록하지 않고
 *   BoosterWatcher/PrebuyWatcher 어댑터를 통해 들어온다.
 */
export const watchRouter = router({
  list: authedProcedure.input(ListInputSchema).query(({ ctx, input }) => {
    if (!ctx.watchEngine) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'watchEngine이 초기화되지 않음',
      });
    }
    const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
    // 다른 계좌 row 노출 금지 — 명시적 accountId 가 활성 계좌와 다르면 거부.
    if (input.accountId !== undefined && input.accountId !== activeAccountId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '다른 계좌의 자동감시주문은 조회할 수 없습니다.',
      });
    }
    return {
      orders: ctx.watchEngine.list({
        status: input.status,
        source: input.source,
        accountId: activeAccountId,
      }),
    };
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
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      // 소유권 사전 검증 — 다른 계좌의 row 는 NOT_FOUND 로 응답해 정보 누설 차단.
      const owned = ctx.db
        .select({ id: watchOrders.id })
        .from(watchOrders)
        .where(and(eq(watchOrders.id, input.id), eq(watchOrders.accountId, activeAccountId)))
        .get();
      if (!owned) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 자동감시주문을 찾을 수 없습니다.',
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
    const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
    // 거래성 mutation — input.accountId 는 반드시 활성 계좌와 일치해야 함.
    if (input.accountId !== activeAccountId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '다른 계좌로의 자동감시주문 등록은 허용되지 않습니다.',
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

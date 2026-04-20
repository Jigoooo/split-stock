import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lotsRepoErrorMessage } from '../../trading/lots-repo';
import { resolveAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

export const lotsRouter = router({
  /**
   * 특정 일자의 차수 스냅샷 조회.
   * pdno를 지정하면 해당 종목만 반환.
   */
  snapshot: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식 필요'),
        pdno: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const result = ctx.lotsRepo.snapshotByDate(accountId, input.date, input.pdno);
      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `차수 스냅샷 조회 실패: ${lotsRepoErrorMessage(result.error)}`,
        });
      }
      return { snapshots: result.value };
    }),

  /**
   * 스냅샷이 존재하는 날짜 목록 조회 (최신순).
   */
  listSnapshotDates: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const result = ctx.lotsRepo.listSnapshotDates(accountId);
      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `스냅샷 날짜 목록 조회 실패: ${lotsRepoErrorMessage(result.error)}`,
        });
      }
      return { dates: result.value };
    }),
});

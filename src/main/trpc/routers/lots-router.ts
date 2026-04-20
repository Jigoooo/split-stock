import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lotsRepoErrorMessage } from '../../trading/lots-repo';
import { requireAccountId, resolveAccountId } from '../router-helpers';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

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
   * 종목별 매매 사이클 조회 — 차수 단위 매수/매도 요약.
   * - accountId 명시 강제 (requireAccountId — per-account 격리).
   * - pdno 옵션: 미지정 시 모든 종목, 지정 시 해당 종목만.
   * - status: 'all' | 'open'(OPEN|BUYING) | 'closed'(SOLD).
   */
  cyclesByPdno: authedProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: z
          .string()
          .regex(/^\d{6}$/, '종목코드는 6자리 숫자')
          .optional(),
        status: z.enum(['all', 'open', 'closed']),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      const result = ctx.lotsRepo.cyclesByPdno({
        accountId,
        status: input.status,
        ...(input.pdno !== undefined ? { pdno: input.pdno } : {}),
      });
      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `매매 사이클 조회 실패: ${lotsRepoErrorMessage(result.error)}`,
        });
      }
      return { cycles: result.value };
    }),

  /**
   * 모든 매매 내역 전용 lot 조회.
   * month/day 기준은 relevantAt = soldAt ?? boughtAt.
   */
  tradeHistory: authedProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31).optional(),
        search: z.string().trim().max(100).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      const result = ctx.lotsRepo.listTradeHistoryLots({
        accountId,
        year: input.year,
        month: input.month,
        ...(input.day !== undefined ? { day: input.day } : {}),
        ...(input.search !== undefined ? { search: input.search } : {}),
      });
      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `모든 매매 내역 조회 실패: ${lotsRepoErrorMessage(result.error)}`,
        });
      }
      return { lots: result.value };
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

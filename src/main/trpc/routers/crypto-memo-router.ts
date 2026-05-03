import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { cryptoMarketMemos } from '../../db/schema';
import { authedProcedure, router } from '../trpc-core';

/**
 * 코인 마켓 메모 라우터 — symbol-memo-router의 코인 미러.
 *
 * - get: 메모 조회. 없으면 null.
 * - set: 메모 본문 upsert. 빈 문자열 허용.
 *
 * market PK는 KRW-BTC 등 UPBIT 형식. (RALPLAN P6 A5)
 */
const MarketSchema = z
  .string()
  .regex(/^[A-Z]{3,5}-[A-Z0-9]{1,10}$/, '마켓 코드 형식이 잘못되었습니다');
const ContentSchema = z.string().max(10_000, '메모는 최대 10,000자까지 가능합니다');

export const cryptoMemoRouter = router({
  get: authedProcedure.input(z.object({ market: MarketSchema })).query(({ ctx, input }) => {
    try {
      const rows = ctx.db
        .select()
        .from(cryptoMarketMemos)
        .where(eq(cryptoMarketMemos.market, input.market))
        .all();
      const row = rows[0];
      if (!row) return null;
      return { content: row.content, updatedAt: row.updatedAt };
    } catch (cause) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `코인 메모 조회 실패: ${String(cause)}`,
      });
    }
  }),

  set: authedProcedure
    .input(z.object({ market: MarketSchema, content: ContentSchema }))
    .mutation(({ ctx, input }) => {
      try {
        const now = Date.now();
        ctx.db
          .insert(cryptoMarketMemos)
          .values({ market: input.market, content: input.content, updatedAt: now })
          .onConflictDoUpdate({
            target: cryptoMarketMemos.market,
            set: { content: input.content, updatedAt: now },
          })
          .run();
        return { ok: true as const };
      } catch (cause) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `코인 메모 저장 실패: ${String(cause)}`,
        });
      }
    }),
});

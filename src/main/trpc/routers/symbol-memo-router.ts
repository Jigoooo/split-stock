import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { symbolMemos } from '../../db/schema';
import { authedProcedure, router } from '../trpc-core';

/** Phase R0: stock-context 전용 라우터 — broker='KIS' 만 다룬다. UPBIT 메모는 cryptoMarketMemos 사용. */
const STOCK_BROKER = 'KIS' as const;

/**
 * 종목 메모 라우터 — 글로벌(계좌 비종속) 종목별 단일 메모.
 *
 * - get: 메모 조회. 없으면 null 반환.
 * - set: 메모 본문 upsert. content는 빈 문자열 허용(메모 클리어).
 *
 * 권한:
 *   - 모든 procedure는 authedProcedure (env 선택 필요).
 *   - per-account 격리는 N/A — 한 사용자 단위로 종목당 1개.
 */
const PdnoSchema = z.string().regex(/^\d{6}$/, '종목코드는 6자리 숫자여야 합니다');
const ContentSchema = z.string().max(10_000, '메모는 최대 10,000자까지 가능합니다');

export const symbolMemoRouter = router({
  get: authedProcedure.input(z.object({ pdno: PdnoSchema })).query(({ ctx, input }) => {
    try {
      const rows = ctx.db
        .select()
        .from(symbolMemos)
        .where(and(eq(symbolMemos.broker, STOCK_BROKER), eq(symbolMemos.pdno, input.pdno)))
        .all();
      const row = rows[0];
      if (!row) return null;
      return { content: row.content, updatedAt: row.updatedAt };
    } catch (cause) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `메모 조회 실패: ${String(cause)}`,
      });
    }
  }),

  set: authedProcedure
    .input(z.object({ pdno: PdnoSchema, content: ContentSchema }))
    .mutation(({ ctx, input }) => {
      try {
        const now = Date.now();
        ctx.db
          .insert(symbolMemos)
          .values({
            broker: STOCK_BROKER,
            pdno: input.pdno,
            content: input.content,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: symbolMemos.pdno,
            set: { content: input.content, updatedAt: now },
          })
          .run();
        return { ok: true as const };
      } catch (cause) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `메모 저장 실패: ${String(cause)}`,
        });
      }
    }),
});

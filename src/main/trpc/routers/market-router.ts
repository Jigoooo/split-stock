import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { inquireDailyChart, inquireOrderbook, inquirePrice } from '../../kis/domestic-stock';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

export const marketRouter = router({
  searchStock: publicProcedure
    .input(
      z.object({
        term: z.string().min(1).max(32),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) => ({
      entries: ctx.stockMasterRepo.search(input.term, input.limit),
    })),

  /**
   * 전체 종목 마스터 반환 — 한글 퍼지/초성 검색을 클라이언트에서 수행하려면 전체 데이터가 필요.
   * KOSPI+KOSDAQ 보통주 약 4000건 수준, 한 번 받고 캐시.
   */
  listAllStock: publicProcedure.query(({ ctx }) => {
    const entries = ctx.stockMasterRepo.list({ offset: 0, limit: 100_000 });
    return { entries };
  }),

  /**
   * 무한스크롤용 페이징 리스트. keyword 생략 시 전체 목록.
   * cursor는 offset 기반 — nextCursor가 null이면 더 이상 페이지 없음.
   * trpc v11 useInfiniteQuery 호환을 위해 필드명을 cursor로 유지.
   */
  listStock: publicProcedure
    .input(
      z.object({
        keyword: z.string().max(32).optional(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(200).default(60),
      }),
    )
    .query(({ ctx, input }) => {
      const offset = input.cursor ?? 0;
      const entries = ctx.stockMasterRepo.list({
        offset,
        limit: input.limit,
        ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
      });
      const total = ctx.stockMasterRepo.countAll(input.keyword);
      const nextCursor = offset + entries.length < total ? offset + entries.length : null;
      return { entries, total, nextCursor };
    }),

  /** 종목 마스터 KIS zip 다운로드 → 로컬 upsert. */
  syncStockMaster: publicProcedure.mutation(async ({ ctx }) => {
    const r = await ctx.stockMasterSync.sync();
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `종목 마스터 동기화 실패: ${r.error.kind} - ${r.error.msg}`,
      });
    }
    return {
      total: r.value.total,
      kospi: r.value.kospi,
      kosdaq: r.value.kosdaq,
      syncedAt: r.value.syncedAt.getTime(),
    };
  }),

  getStockMasterStatus: publicProcedure.query(({ ctx }) => {
    const lastSyncAt = ctx.stockMasterSync.getLastSyncAt();
    const total = ctx.stockMasterRepo.countAll();
    return {
      lastSyncAt: lastSyncAt ? lastSyncAt.getTime() : null,
      total,
      isStale: ctx.stockMasterSync.isStale(),
    };
  }),

  /**
   * 봉 조회 — period별 KIS inquire-daily-itemchartprice.
   * KIS는 1회 호출당 최대 100건만 반환하므로, 확장은 클라이언트가 toIsoDate를 옮겨가며 여러 번 호출해 chunk로 취합.
   *   - toIsoDate 미지정: 오늘까지. 범위는 period별 chunk months 고정
   *   - D: 4개월 chunk (~80 영업일), W: 24개월 chunk (~100주), M: 100개월 chunk (~100봉)
   */
  getDailyChart: authedProcedure
    .input(
      z.object({
        code: z.string().regex(/^\d{6}$/),
        period: z.enum(['D', 'W', 'M']).default('D'),
        /** 조회 종료 시각 (ms epoch). 생략 시 현재. */
        toMs: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const CHUNK_MONTHS: Record<'D' | 'W' | 'M', number> = { D: 4, W: 24, M: 100 };
      const to = input.toMs ? new Date(input.toMs) : new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - CHUNK_MONTHS[input.period]);
      const r = await inquireDailyChart(
        {
          http: ctx.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
        },
        { code: input.code, from, to, period: input.period },
      );
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `봉 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return { candles: r.value, toMs: to.getTime() };
    }),

  /**
   * REST 호가 스냅샷 (장외 시간대 fallback용).
   * 실시간 WS(H0STASP0)가 흐르지 않을 때 UI가 주기적으로 폴링해 최소 정보 표시.
   */
  getOrderbook: authedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const r = await inquireOrderbook(
        {
          http: ctx.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
        },
        input.code,
      );
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `호가 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return { orderbook: r.value };
    }),

  getPrice: authedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const r = await inquirePrice(
        {
          http: ctx.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
        },
        input.code,
      );
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `현재가 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return r.value;
    }),
});

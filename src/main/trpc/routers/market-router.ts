import type { OrderbookSnapshot, Quote } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { TradingCalendarImportError } from '../../trading/trading-calendar-service';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYyyymmdd(yyyymmdd: string): Date {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(y, m, d);
}

/**
 * 도메인 Quote → 기존 KIS QuoteResult shape (renderer wire compat).
 * Stage 8 에서 renderer 를 도메인 모델로 전환 시 helper 제거.
 */
function toLegacyQuote(q: Quote) {
  return {
    code: q.symbol,
    price: q.price,
    dayChange: q.dayChange,
    dayChangeRate: q.dayChangeRate,
    accumVolume: q.accumVolume,
    open: q.open,
    high: q.high,
    low: q.low,
    upperLimit: q.upperLimit,
    lowerLimit: q.lowerLimit,
    prevClose: q.prevClose,
  };
}

/**
 * 도메인 OrderbookSnapshot → 기존 KIS shape ({pdno, asks/bids: [{price, quantity}]}).
 */
function toLegacyOrderbook(o: OrderbookSnapshot) {
  return {
    pdno: o.symbol,
    time: o.time,
    asks: o.asks.map((a) => ({ price: a.price, quantity: a.qty })),
    bids: o.bids.map((b) => ({ price: b.price, quantity: b.qty })),
    totalAskQty: o.totalAskQty,
    totalBidQty: o.totalBidQty,
    expectedPrice: o.expectedPrice,
    expectedQty: o.expectedQty,
  };
}

export const marketRouter = router({
  getTradingDayStatus: publicProcedure
    .input(
      z
        .object({
          date: z
            .string()
            .regex(/^\d{8}$/)
            .optional(),
          accountId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const date = input?.date ? parseYyyymmdd(input.date) : new Date();
      const accountId = input?.accountId ?? ctx.activeAccountId;
      const broker = accountId !== null ? ctx.brokerForAccount(accountId) : null;
      if (broker) {
        const r = await broker.getTradingDayStatus(date);
        if (r.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `거래일 확인 실패: ${r.error.kind} - ${r.error.msg}`,
          });
        }
        return r.value;
      }
      return ctx.tradingCalendar.getTradingDayStatus(date);
    }),

  getTradingCalendarStatus: publicProcedure.query(({ ctx }) => ctx.tradingCalendar.getStatus()),

  refreshTradingCalendar: authedProcedure.mutation(({ ctx }) =>
    ctx.tradingCalendar.refreshTradingCalendar(),
  ),

  importTradingCalendar: authedProcedure
    .input(
      z.object({
        content: z.string().min(1),
        source: z.enum(['KRX_DOWNLOAD', 'MANUAL_IMPORT']).default('MANUAL_IMPORT'),
        sourceVersion: z.string().min(1).max(80).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      try {
        return ctx.tradingCalendar.importTradingCalendar({
          content: input.content,
          source: input.source,
          ...(input.sourceVersion !== undefined && { sourceVersion: input.sourceVersion }),
        });
      } catch (cause) {
        if (cause instanceof TradingCalendarImportError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: cause.message });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

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
      const credResult = ctx.credentialsRepo.loadCredentialsByEnv(env);
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

      const fromStr = toIsoDate(from);
      const toStr = toIsoDate(to);
      const cached = ctx.candlesRepo.getInRange(input.code, input.period, fromStr, toStr);
      // 최근 chunk(toMs 미지정)는 오늘 부분체결 바 갱신을 위해 항상 broker 재조회.
      // 과거 chunk는 cache에 30건 이상 있으면 broker 호출 생략.
      const isRecent = input.toMs === undefined;
      if (!isRecent && cached.length >= 30) {
        return { candles: cached, toMs: to.getTime() };
      }

      // Stage 4c: BrokerPort.getDailyOhlcv 추상으로 전환. activeAccountId fallback 사용
      // (market-router 는 계좌 지정 없이 env-credentials 로 호출되던 read-only API 였음).
      const accountId = ctx.activeAccountId;
      const broker = accountId !== null ? ctx.brokerForAccount(accountId) : null;
      if (!broker) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: '활성 계좌의 broker 가 준비되지 않았습니다',
        });
      }
      void tokenResult; // ensureSession 은 broker 내부에서 처리
      const r = await broker.getDailyOhlcv({
        symbol: input.code,
        from,
        to,
        period: input.period,
      });
      if (r.isErr()) {
        // 네트워크/상장이전 등으로 실패했어도 cache에 이미 있는 것만이라도 보여주면 UX에 유리.
        if (cached.length > 0) {
          return { candles: cached, toMs: to.getTime() };
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `봉 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      // 받은 봉을 cache에 upsert — 다음번엔 네트워크 왕복 없이 반환 가능
      ctx.candlesRepo.upsertMany(input.code, input.period, r.value);
      return { candles: r.value, toMs: to.getTime() };
    }),

  /**
   * REST 호가 스냅샷 (장외 시간대 fallback용).
   * 실시간 WS(H0STASP0)가 흐르지 않을 때 UI가 주기적으로 폴링해 최소 정보 표시.
   */
  getOrderbook: authedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const accountId = ctx.activeAccountId;
      const broker = accountId !== null ? ctx.brokerForAccount(accountId) : null;
      if (!broker) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: '활성 계좌의 broker 가 준비되지 않았습니다',
        });
      }
      const r = await broker.getOrderbook(input.code);
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `호가 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return { orderbook: toLegacyOrderbook(r.value) };
    }),

  getPrice: authedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const accountId = ctx.activeAccountId;
      const broker = accountId !== null ? ctx.brokerForAccount(accountId) : null;
      if (!broker) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: '활성 계좌의 broker 가 준비되지 않았습니다',
        });
      }
      const r = await broker.getQuote(input.code);
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `현재가 조회 실패: ${r.error.kind} - ${r.error.msg}`,
        });
      }
      return toLegacyQuote(r.value);
    }),
});

import {
  CryptoCandleUnitSchema,
  CryptoMarketCodeSchema,
  CryptoOrderIntentSchema,
  type CryptoPrivateAssetEvent,
  type CryptoPrivateOrderEvent,
  type CryptoRealtimeCandle,
  type CryptoRealtimeOrderbook,
  type CryptoRealtimeTicker,
  type CryptoRealtimeTrade,
  isUpbitCredentials,
  type UpbitCredentials,
} from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CryptoTradingRepo } from '../../crypto/crypto-repo';
import { UpbitExchangeAdapter } from '../../crypto/upbit/adapter';
import type { Context } from '../context';
import { publicProcedure, router, runtimeProcedure } from '../trpc-core';

const AccountIdField = z.number().int().positive();
const CandleInputSchema = z.object({
  exchange: z.literal('UPBIT').default('UPBIT'),
  market: CryptoMarketCodeSchema,
  unit: CryptoCandleUnitSchema.default('1m'),
  count: z.number().int().min(1).max(200).default(200),
  toMs: z.number().int().positive().optional(),
});
const MarketWatchInputSchema = z.object({
  market: CryptoMarketCodeSchema,
  unit: CryptoCandleUnitSchema.default('1m'),
});

function createPushStream<T>(
  signal: AbortSignal | undefined,
  subscribe: (push: (value: T) => void) => () => void,
): AsyncIterable<T> {
  return (async function* stream() {
    if (signal?.aborted) return;

    const queue: T[] = [];
    let wake: (() => void) | null = null;
    let stopped = false;
    const wakeNext = (): void => {
      wake?.();
      wake = null;
    };
    const unsubscribe = subscribe((value) => {
      queue.push(value);
      wakeNext();
    });
    const onAbort = (): void => {
      stopped = true;
      wakeNext();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (!stopped) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield queue.shift() as T;
      }
    } finally {
      stopped = true;
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      wakeNext();
    }
  })();
}

async function* emptyStream<T>(): AsyncIterable<T> {}

function throwUpbitError(error: {
  kind: string;
  message: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
}): never {
  const code =
    error.kind === 'AUTH_FAILED' || error.kind === 'PERMISSION_DENIED'
      ? 'UNAUTHORIZED'
      : error.kind === 'VALIDATION'
        ? 'BAD_REQUEST'
        : error.kind === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : error.kind === 'RATE_LIMITED' || error.kind === 'RATE_LIMIT_PENALTY'
            ? 'TOO_MANY_REQUESTS'
            : 'INTERNAL_SERVER_ERROR';
  throw new TRPCError({
    code,
    message: `[${error.kind}${error.code ? `/${error.code}` : ''}] ${error.message}`,
    cause: {
      code: error.code ?? null,
      retryAfterMs: error.retryAfterMs ?? null,
      status: error.status ?? null,
    },
  });
}

function createPublicUpbit() {
  return new UpbitExchangeAdapter();
}

function loadPrivateUpbitCredentials(ctx: Context, accountId: number): UpbitCredentials {
  if (ctx.currentEnv !== 'PROD' || ctx.activeAccountId !== accountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '활성 Upbit 실전 계좌에서만 실행할 수 있습니다.',
    });
  }
  const account = ctx.activeAccounts.getById(accountId);
  if (!account) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '대상 계좌를 찾을 수 없습니다.' });
  }
  if (account.broker !== 'UPBIT' || account.env !== ctx.currentEnv) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '활성 Upbit 계좌가 아닙니다.' });
  }
  const credentials = ctx.credentialsRepo.loadCredentials(accountId);
  if (credentials.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Upbit 자격증명 로드 실패: ${credentials.error.kind}`,
    });
  }
  if (!credentials.value || !isUpbitCredentials(credentials.value)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Upbit 자격증명이 없습니다.' });
  }
  return credentials.value;
}

function createPrivateUpbit(ctx: Context, accountId: number): UpbitExchangeAdapter {
  const credentials = loadPrivateUpbitCredentials(ctx, accountId);
  return new UpbitExchangeAdapter({
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
  });
}

export const cryptoRouter = router({
  listMarkets: publicProcedure
    .input(
      z
        .object({
          term: z.string().trim().max(40).optional(),
          quoteCurrency: z.enum(['KRW', 'BTC', 'USDT']).optional(),
          limit: z.number().int().min(1).max(200).default(80),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const adapter = createPublicUpbit();
      const result = await adapter.listMarkets();
      if (result.isErr()) throwUpbitError(result.error);
      const term = input?.term?.toLowerCase() ?? '';
      const quote = input?.quoteCurrency;
      const filtered = result.value.filter((market) => {
        if (quote && market.quoteCurrency !== quote) return false;
        if (!term) return true;
        return (
          market.market.toLowerCase().includes(term) ||
          market.koreanName.toLowerCase().includes(term) ||
          market.englishName.toLowerCase().includes(term)
        );
      });
      const entries = filtered.slice(0, input?.limit ?? 80);
      new CryptoTradingRepo(ctx.db).upsertMarkets(entries);
      return { entries, total: filtered.length };
    }),

  getCandles: publicProcedure.input(CandleInputSchema).query(async ({ ctx, input }) => {
    const result = await createPublicUpbit().getCandles({
      market: input.market,
      unit: input.unit,
      count: input.count,
      ...(input.toMs !== undefined ? { toMs: input.toMs } : {}),
    });
    if (result.isErr()) throwUpbitError(result.error);
    new CryptoTradingRepo(ctx.db).upsertCandles(result.value);
    return { candles: result.value };
  }),

  getTicker: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .query(async ({ input }) => {
      const result = await createPublicUpbit().getTicker(input.market);
      if (result.isErr()) throwUpbitError(result.error);
      return result.value;
    }),

  getOrderbookInstruments: publicProcedure
    .input(z.object({ markets: z.array(CryptoMarketCodeSchema).min(1).max(50) }))
    .query(async ({ input }) => {
      const result = await createPublicUpbit().getOrderbookInstruments(input.markets);
      if (result.isErr()) throwUpbitError(result.error);
      return { entries: result.value };
    }),

  getOrderbook: publicProcedure
    .input(
      z.object({
        market: CryptoMarketCodeSchema,
        count: z.number().int().min(1).max(30).default(30),
      }),
    )
    .query(async ({ input }) => {
      const result = await createPublicUpbit().getOrderbook(input.market, input.count);
      if (result.isErr()) throwUpbitError(result.error);
      return result.value;
    }),

  watchMarket: publicProcedure.input(MarketWatchInputSchema).mutation(({ ctx, input }) => {
    ctx.cryptoRealtime?.watchMarket({ market: input.market, candleUnit: input.unit });
    return { ok: ctx.cryptoRealtime != null };
  }),

  unwatchMarket: publicProcedure.input(MarketWatchInputSchema).mutation(({ ctx, input }) => {
    ctx.cryptoRealtime?.unwatchMarket({ market: input.market, candleUnit: input.unit });
    return { ok: true as const };
  }),

  getLatestRealtime: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .query(({ ctx, input }) => ({
      realtime: ctx.cryptoRealtime?.bus.getLatestRealtime(input.market) ?? {
        ticker: null,
        trade: null,
        orderbook: null,
        candle: null,
      },
    })),

  getRealtimeStatus: publicProcedure.query(({ ctx }) => ({
    status: ctx.cryptoRealtime?.getStatus() ?? { publicSessions: [], privateSessions: [] },
  })),

  onTicker: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoRealtimeTicker>();
      return createPushStream<CryptoRealtimeTicker>(signal, (push) =>
        bus.subscribeTicker(input.market, (ticker) => push(ticker)),
      );
    }),

  onOrderbook: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoRealtimeOrderbook>();
      return createPushStream<CryptoRealtimeOrderbook>(signal, (push) =>
        bus.subscribeOrderbook(input.market, (orderbook) => push(orderbook)),
      );
    }),

  onTrade: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoRealtimeTrade>();
      return createPushStream<CryptoRealtimeTrade>(signal, (push) =>
        bus.subscribeTrade(input.market, (trade) => push(trade)),
      );
    }),

  onCandle: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoRealtimeCandle>();
      return createPushStream<CryptoRealtimeCandle>(signal, (push) =>
        bus.subscribeCandle(input.market, (candle) => push(candle)),
      );
    }),

  getBalances: runtimeProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const accountId = input?.accountId ?? ctx.activeAccountId;
      if (accountId === null) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '활성 계좌가 없습니다.' });
      }
      const adapter = createPrivateUpbit(ctx, accountId);
      const result = await adapter.listBalances();
      if (result.isErr()) throwUpbitError(result.error);
      new CryptoTradingRepo(ctx.db).upsertBalances(accountId, 'UPBIT', result.value);
      return { accountId, balances: result.value };
    }),

  placeOrder: runtimeProcedure
    .input(CryptoOrderIntentSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      const adapter = createPrivateUpbit(ctx, input.accountId);
      const result = await adapter.createOrder(input);
      if (result.isErr()) throwUpbitError(result.error);
      new CryptoTradingRepo(ctx.db).upsertOrder({
        accountId: input.accountId,
        exchange: 'UPBIT',
        order: result.value,
      });
      ctx.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'crypto.upbit.order.placed',
        payload: {
          accountId: input.accountId,
          market: input.market,
          side: input.side,
          ordType: input.ordType,
          uuid: result.value.uuid,
        },
      });
      return result.value;
    }),

  cancelOrder: runtimeProcedure
    .input(
      z
        .object({
          accountId: AccountIdField,
          uuid: z.string().trim().min(1).optional(),
          identifier: z.string().trim().min(1).optional(),
        })
        .refine((value) => value.uuid || value.identifier, {
          message: 'uuid 또는 identifier가 필요합니다.',
          path: ['uuid'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const adapter = createPrivateUpbit(ctx, input.accountId);
      const result = await adapter.cancelOrder({
        ...(input.uuid !== undefined && { uuid: input.uuid }),
        ...(input.identifier !== undefined && { identifier: input.identifier }),
      });
      if (result.isErr()) throwUpbitError(result.error);
      new CryptoTradingRepo(ctx.db).upsertOrder({
        accountId: input.accountId,
        exchange: 'UPBIT',
        order: result.value,
      });
      return result.value;
    }),

  watchPrivate: runtimeProcedure
    .input(z.object({ accountId: AccountIdField, market: CryptoMarketCodeSchema.optional() }))
    .mutation(({ ctx, input }) => {
      const credentials = loadPrivateUpbitCredentials(ctx, input.accountId);
      ctx.cryptoRealtime?.watchPrivate({
        accountId: input.accountId,
        accessKey: credentials.accessKey,
        secretKey: credentials.secretKey,
        ...(input.market ? { markets: [input.market] } : {}),
      });
      return { ok: ctx.cryptoRealtime != null };
    }),

  reconcileOrders: runtimeProcedure
    .input(
      z
        .object({ accountId: AccountIdField.optional(), market: CryptoMarketCodeSchema.optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const accountId = input?.accountId ?? ctx.activeAccountId;
      if (accountId === null) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '활성 계좌가 없습니다.' });
      }
      const credentials = loadPrivateUpbitCredentials(ctx, accountId);
      const result = await ctx.cryptoRealtime?.reconcilePrivate({
        accountId,
        accessKey: credentials.accessKey,
        secretKey: credentials.secretKey,
        reason: 'manual',
        ...(input?.market !== undefined ? { market: input.market } : {}),
      });
      if (!result) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '코인 실시간 서비스가 준비되지 않았습니다.',
        });
      }
      if (result.isErr()) throwUpbitError(result.error);
      return result.value;
    }),

  unwatchPrivate: runtimeProcedure
    .input(z.object({ accountId: AccountIdField }))
    .mutation(({ ctx, input }) => {
      ctx.cryptoRealtime?.unwatchPrivate(input.accountId);
      return { ok: true as const };
    }),

  onPrivateOrder: runtimeProcedure
    .input(z.object({ accountId: AccountIdField }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoPrivateOrderEvent>();
      return createPushStream<CryptoPrivateOrderEvent>(signal, (push) =>
        bus.subscribePrivateOrder(input.accountId, (event) => push(event)),
      );
    }),

  onPrivateAsset: runtimeProcedure
    .input(z.object({ accountId: AccountIdField }))
    .subscription(({ ctx, input, signal }) => {
      const bus = ctx.cryptoRealtime?.bus;
      if (!bus) return emptyStream<CryptoPrivateAssetEvent>();
      return createPushStream<CryptoPrivateAssetEvent>(signal, (push) =>
        bus.subscribePrivateAsset(input.accountId, (event) => push(event)),
      );
    }),

  listRecentOrders: runtimeProcedure
    .input(
      z
        .object({
          accountId: AccountIdField.optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const accountId = input?.accountId ?? ctx.activeAccountId;
      if (accountId === null) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '활성 계좌가 없습니다.' });
      }
      const account = ctx.activeAccounts.getById(accountId);
      if (ctx.currentEnv !== 'PROD' || ctx.activeAccountId !== accountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '활성 Upbit 실전 계좌에서만 조회할 수 있습니다.',
        });
      }
      if (!account || account.broker !== 'UPBIT' || account.env !== ctx.currentEnv) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '활성 Upbit 계좌가 아닙니다.' });
      }
      return {
        accountId,
        orders: new CryptoTradingRepo(ctx.db).listRecentOrders(accountId, input?.limit ?? 100),
      };
    }),
});

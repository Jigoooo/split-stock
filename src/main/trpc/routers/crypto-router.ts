import {
  type CryptoAutoGuardConfig,
  CryptoAutoGuardConfigSchema,
  CryptoAutoTemplateUpsertInputSchema,
  CryptoAutoWatchListFilterSchema,
  CryptoAutoWatchUpsertInputSchema,
  CryptoCandleUnitSchema,
  CryptoKrwMarketCodeSchema,
  CryptoMarketCodeSchema,
  CryptoOrderIntentSchema,
  type CryptoPrivateAssetEvent,
  type CryptoPrivateOrderEvent,
  type CryptoReadonlySmokeResult,
  type CryptoRealtimeCandle,
  type CryptoRealtimeOrderbook,
  type CryptoRealtimeTicker,
  type CryptoRealtimeTrade,
  CryptoStrategyProfileSchema,
  isUpbitCredentials,
  type UpbitCredentials,
} from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CryptoAutoTradingRepo } from '../../crypto/crypto-auto-repo';
import { CryptoAutoTradingService } from '../../crypto/crypto-auto-service';
import { CryptoTradingRepo } from '../../crypto/crypto-repo';
import { UpbitExchangeAdapter } from '../../crypto/upbit/adapter';
import { normalizeUpbitKrwLimitPrice } from '../../crypto/upbit/decimal';
import { notifyTrade } from '../../notification/trade-notifier';
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
const AutoMarketInputSchema = z.object({
  accountId: AccountIdField.optional(),
  market: CryptoKrwMarketCodeSchema,
});
const AutoConfigInputSchema = AutoMarketInputSchema.extend({
  config: CryptoAutoGuardConfigSchema.partial(),
});
const AutoStrategyInputSchema = AutoMarketInputSchema.extend({
  profile: CryptoStrategyProfileSchema,
});
const AutoRunInputSchema = AutoMarketInputSchema.extend({
  tradePrice: z.string().trim().optional(),
});
const AutoStartInputSchema = AutoMarketInputSchema.extend({
  intervalMs: z.number().int().min(5000).max(3_600_000).default(60_000),
});

type CryptoAutoJob = {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
};

const cryptoAutoJobs = new Map<string, CryptoAutoJob>();

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

function createCryptoAutoService(ctx: Context): CryptoAutoTradingService {
  const rateGuard = ctx.rateGuard;
  const cryptoProtectionGuard = ctx.cryptoProtectionGuard;
  return new CryptoAutoTradingService({
    repo: new CryptoAutoTradingRepo(ctx.db),
    logger: ctx.logger,
    safetyRegistry: ctx.safetyRegistry,
    ...(rateGuard ? { rateGuard } : {}),
    ...(cryptoProtectionGuard
      ? {
          protectionGuard: {
            canBuyToday: (accountId, market, amountKrw) =>
              cryptoProtectionGuard.canBuyToday(accountId, market, amountKrw),
          },
        }
      : {}),
  });
}

function activeAccountIdOrThrow(ctx: Context, accountId: number | undefined): number {
  const resolved = accountId ?? ctx.activeAccountId;
  if (resolved === null) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '활성 계좌가 없습니다.' });
  }
  return resolved;
}

function exchangeErrorMessage(error: { kind: string; message: string; code?: string }): string {
  return `[${error.kind}${error.code ? `/${error.code}` : ''}] ${error.message}`;
}

function cryptoAutoJobKey(accountId: number, market: string): string {
  return `${accountId}:${market}`;
}

function stopCryptoAutoJob(accountId: number, market: string): boolean {
  const key = cryptoAutoJobKey(accountId, market);
  const job = cryptoAutoJobs.get(key);
  if (!job) return false;
  clearInterval(job.timer);
  cryptoAutoJobs.delete(key);
  return true;
}

function withWatchRuntimeState(
  ctx: Context,
  watches: ReturnType<CryptoAutoTradingRepo['listWatches']>,
) {
  const service = createCryptoAutoService(ctx);
  return watches.map((watch) => {
    const gate = service.getGate({
      accountId: watch.accountId,
      market: watch.market,
      requireIdempotency: false,
    });
    return {
      ...watch,
      blockedReasons: gate.isOk() ? gate.value.blockedReasons : [gate.error.message],
      runtimeRunning: cryptoAutoJobs.has(cryptoAutoJobKey(watch.accountId, watch.market)),
    };
  });
}

async function readAutoTickInputs(ctx: Context, input: z.infer<typeof AutoRunInputSchema>) {
  const accountId = activeAccountIdOrThrow(ctx, input.accountId);
  const privateAdapter = createPrivateUpbit(ctx, accountId);
  const balancesResult = await privateAdapter.listBalances();
  if (balancesResult.isErr()) throwUpbitError(balancesResult.error);
  new CryptoTradingRepo(ctx.db).upsertBalances(accountId, 'UPBIT', balancesResult.value);

  const tradePrice =
    input.tradePrice ??
    (await (async () => {
      const tickerResult = await createPublicUpbit().getTicker(input.market);
      if (tickerResult.isErr()) throwUpbitError(tickerResult.error);
      return tickerResult.value.tradePrice;
    })());

  return {
    accountId,
    privateAdapter,
    balances: balancesResult.value,
    tradePrice,
  };
}

function persistAutoOrderIfPresent(ctx: Context, accountId: number, value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const order = value as {
    uuid?: string;
    market?: string;
    side?: string;
    ord_type?: string;
    state?: string;
    price?: string;
    volume?: string;
    remaining_volume?: string;
    executed_volume?: string;
    paid_fee?: string;
    locked?: string;
    created_at?: string;
    identifier?: string;
  };
  if (
    !order.uuid ||
    !order.market ||
    !order.side ||
    !order.ord_type ||
    !order.state ||
    !order.created_at
  ) {
    return;
  }
  new CryptoTradingRepo(ctx.db).upsertOrder({
    accountId,
    exchange: 'UPBIT',
    order: {
      uuid: order.uuid,
      market: order.market,
      side: order.side,
      ord_type: order.ord_type,
      state: order.state,
      ...(order.price !== undefined ? { price: order.price } : {}),
      ...(order.volume !== undefined ? { volume: order.volume } : {}),
      remaining_volume: order.remaining_volume ?? '0',
      executed_volume: order.executed_volume ?? '0',
      paid_fee: order.paid_fee ?? '0',
      locked: order.locked ?? '0',
      created_at: order.created_at,
      ...(order.identifier !== undefined ? { identifier: order.identifier } : {}),
    },
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
      const accountId = activeAccountIdOrThrow(ctx, input?.accountId);
      const adapter = createPrivateUpbit(ctx, accountId);
      const result = await adapter.listBalances();
      if (result.isErr()) throwUpbitError(result.error);
      new CryptoTradingRepo(ctx.db).upsertBalances(accountId, 'UPBIT', result.value);
      return { accountId, balances: result.value };
    }),

  runReadonlySmoke: runtimeProcedure
    .input(
      z
        .object({ accountId: AccountIdField.optional(), market: CryptoMarketCodeSchema.optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input?.accountId);
      const credentials = loadPrivateUpbitCredentials(ctx, accountId);
      const adapter = new UpbitExchangeAdapter({
        accessKey: credentials.accessKey,
        secretKey: credentials.secretKey,
      });
      const checkedAt = Date.now();

      const balancesResult = await adapter.listBalances();
      if (balancesResult.isOk()) {
        new CryptoTradingRepo(ctx.db).upsertBalances(accountId, 'UPBIT', balancesResult.value);
      }

      let reconciliationResult = null;
      let reconciliationError: string | null = null;
      if (ctx.cryptoRealtime) {
        const alreadyWatching = ctx.cryptoRealtime
          .getStatus()
          .privateSessions.some((session) => session.accountId === accountId);
        if (!alreadyWatching) {
          ctx.cryptoRealtime.watchPrivate({
            accountId,
            accessKey: credentials.accessKey,
            secretKey: credentials.secretKey,
            ...(input?.market ? { markets: [input.market] } : {}),
          });
        }
        const result = await ctx.cryptoRealtime.reconcilePrivate({
          accountId,
          accessKey: credentials.accessKey,
          secretKey: credentials.secretKey,
          reason: 'manual',
          ...(input?.market !== undefined ? { market: input.market } : {}),
        });
        if (result.isOk()) reconciliationResult = result.value;
        else reconciliationError = exchangeErrorMessage(result.error);
      } else {
        reconciliationError = '코인 실시간 서비스가 준비되지 않았습니다.';
      }

      const privateStatus =
        ctx.cryptoRealtime
          ?.getStatus()
          .privateSessions.find((session) => session.accountId === accountId) ?? null;
      const smokeResult: CryptoReadonlySmokeResult = {
        accountId,
        exchange: 'UPBIT' as const,
        checkedAt,
        balances: {
          ok: balancesResult.isOk(),
          count: balancesResult.isOk() ? balancesResult.value.length : 0,
          error: balancesResult.isErr() ? exchangeErrorMessage(balancesResult.error) : null,
        },
        privateWs: {
          ok:
            privateStatus !== null &&
            privateStatus.state !== 'failed' &&
            privateStatus.state !== 'closed',
          state: privateStatus?.state ?? 'unavailable',
          lastMessageAt: privateStatus?.lastMessageAt ?? null,
          lastError: privateStatus?.lastError ?? null,
          error: ctx.cryptoRealtime ? null : '코인 실시간 서비스가 준비되지 않았습니다.',
        },
        reconciliation: {
          ok: reconciliationResult !== null,
          result: reconciliationResult,
          error: reconciliationError,
        },
        dangerousCallsBlocked: true as const,
      };
      if (input?.market) {
        createCryptoAutoService(ctx).markReadonlySmoke({
          accountId,
          market: input.market,
          smoke: smokeResult,
        });
      }
      return smokeResult;
    }),

  getAutoStatus: runtimeProcedure.input(AutoMarketInputSchema).query(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    const repo = new CryptoAutoTradingRepo(ctx.db);
    const service = createCryptoAutoService(ctx);
    const gate = service.getGate({
      accountId,
      market: input.market,
      requireIdempotency: false,
    });
    if (gate.isErr()) throwUpbitError(gate.error);
    const dryRunLots = repo.listOpenLots(accountId, input.market, 'dry-run');
    const liveLots = repo.listOpenLots(accountId, input.market, 'live');
    return {
      accountId,
      market: input.market,
      config: repo.getConfig(accountId, input.market),
      openLots: [...dryRunLots, ...liveLots],
      dryRunLots,
      liveLots,
      recentEvents: repo.listRecentEvents(accountId, input.market, 50),
      gate: gate.value,
      runtimeRunning: cryptoAutoJobs.has(cryptoAutoJobKey(accountId, input.market)),
    };
  }),

  saveAutoConfig: runtimeProcedure.input(AutoConfigInputSchema).mutation(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    const repo = new CryptoAutoTradingRepo(ctx.db);
    const config = repo.upsertConfig(
      accountId,
      input.market,
      input.config as Partial<CryptoAutoGuardConfig>,
    );
    const event = repo.insertEvent({
      accountId,
      market: input.market,
      mode: config.mode,
      kind: 'config',
      action: 'config',
      reason: 'crypto auto config saved',
      result: config,
    });
    return { accountId, market: input.market, config, event };
  }),

  getAutoStrategy: runtimeProcedure.input(AutoMarketInputSchema).query(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    const repo = new CryptoAutoTradingRepo(ctx.db);
    return {
      accountId,
      market: input.market,
      profile: repo.getStrategy(accountId, input.market),
    };
  }),

  saveAutoStrategy: runtimeProcedure.input(AutoStrategyInputSchema).mutation(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    const repo = new CryptoAutoTradingRepo(ctx.db);
    const profile = repo.upsertStrategy(accountId, input.market, input.profile);
    const config = repo.getConfig(accountId, input.market);
    const event = repo.insertEvent({
      accountId,
      market: input.market,
      mode: config.mode,
      kind: 'config',
      action: 'config',
      reason: 'crypto auto strategy saved',
      result: profile,
    });
    return { accountId, market: input.market, profile, event };
  }),

  listAutoWatches: runtimeProcedure
    .input(CryptoAutoWatchListFilterSchema)
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input?.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const repo = new CryptoAutoTradingRepo(ctx.db);
      const watches = repo.listWatches(accountId, input);
      return { accountId, watches: withWatchRuntimeState(ctx, watches) };
    }),

  getAutoWatch: runtimeProcedure
    .input(z.object({ accountId: AccountIdField.optional(), id: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const repo = new CryptoAutoTradingRepo(ctx.db);
      const watch = repo.getWatch(accountId, input.id);
      if (!watch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '코인 자동감시를 찾을 수 없습니다.' });
      }
      return { accountId, watch: withWatchRuntimeState(ctx, [watch])[0] };
    }),

  createAutoWatch: runtimeProcedure
    .input(CryptoAutoWatchUpsertInputSchema)
    .mutation(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const repo = new CryptoAutoTradingRepo(ctx.db);
      const watch = repo.upsertWatch(accountId, input);
      repo.insertEvent({
        accountId,
        market: watch.market,
        mode: watch.config.mode,
        kind: 'config',
        action: 'config',
        reason: 'crypto auto watch saved',
        result: { watchId: watch.id, status: watch.status },
      });
      return { accountId, watch: withWatchRuntimeState(ctx, [watch])[0] };
    }),

  updateAutoWatch: runtimeProcedure
    .input(CryptoAutoWatchUpsertInputSchema)
    .mutation(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const repo = new CryptoAutoTradingRepo(ctx.db);
      const watch = repo.upsertWatch(accountId, input);
      return { accountId, watch: withWatchRuntimeState(ctx, [watch])[0] };
    }),

  listClosedLots: runtimeProcedure
    .input(
      AutoMarketInputSchema.extend({
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const lots = new CryptoAutoTradingRepo(ctx.db).listClosedLots(accountId, input.market, {
        limit: input.limit,
      });
      return { accountId, market: input.market, lots };
    }),

  /** 계좌 전체 종료 차수 (market 무관). 좌측 '과거 거래 종목' 탭 — stock cyclesByPdno(status='closed') 동등. */
  listAllClosedLots: runtimeProcedure
    .input(
      z.object({
        accountId: AccountIdField.optional(),
        limit: z.number().int().min(1).max(2000).default(500),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const lots = new CryptoAutoTradingRepo(ctx.db).listAllClosedLots(accountId, {
        limit: input.limit,
      });
      return { accountId, lots };
    }),

  /** 매매내역 전용 lot 조회 (market 무관). 우측 '모든 매매내역' 탭 — stock lots.tradeHistory 동등. */
  listAllTradeHistoryLots: runtimeProcedure
    .input(
      z.object({
        accountId: AccountIdField.optional(),
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31).optional(),
        search: z.string().trim().max(100).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const lots = new CryptoAutoTradingRepo(ctx.db).listAllTradeHistoryLots(accountId, {
        year: input.year,
        month: input.month,
        ...(input.day !== undefined ? { day: input.day } : {}),
        ...(input.search !== undefined ? { search: input.search } : {}),
      });
      return { accountId, lots };
    }),

  listAutoStrategyTemplates: runtimeProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input?.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      return {
        accountId,
        templates: new CryptoAutoTradingRepo(ctx.db).listTemplates(accountId),
      };
    }),

  saveAutoStrategyTemplate: runtimeProcedure
    .input(CryptoAutoTemplateUpsertInputSchema)
    .mutation(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const template = new CryptoAutoTradingRepo(ctx.db).saveTemplate(accountId, input);
      return { accountId, template };
    }),

  deleteAutoStrategyTemplate: runtimeProcedure
    .input(z.object({ accountId: AccountIdField.optional(), id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const accountId = activeAccountIdOrThrow(ctx, input.accountId);
      loadPrivateUpbitCredentials(ctx, accountId);
      const deleted = new CryptoAutoTradingRepo(ctx.db).deleteTemplate(accountId, input.id);
      return { accountId, id: input.id, deleted };
    }),

  runAutoDryTick: runtimeProcedure.input(AutoRunInputSchema).mutation(async ({ ctx, input }) => {
    const tick = await readAutoTickInputs(ctx, input);
    const result = createCryptoAutoService(ctx).runDryTick({
      accountId: tick.accountId,
      market: input.market,
      balances: tick.balances,
      tradePrice: tick.tradePrice,
    });
    if (result.isErr()) throwUpbitError(result.error);
    return result.value;
  }),

  runAutoLiveTick: runtimeProcedure.input(AutoRunInputSchema).mutation(async ({ ctx, input }) => {
    const tick = await readAutoTickInputs(ctx, input);
    const result = await createCryptoAutoService(ctx).runLiveTick({
      accountId: tick.accountId,
      market: input.market,
      balances: tick.balances,
      tradePrice: tick.tradePrice,
      adapter: tick.privateAdapter,
    });
    if (result.isErr()) throwUpbitError(result.error);
    persistAutoOrderIfPresent(ctx, tick.accountId, result.value.event.result);
    // RALPLAN P6 #6 — 자동매매 체결 알림 (gate 통과 + 실 placement 만).
    const intent = result.value.intent;
    if (
      result.value.gate.ok &&
      result.value.event.kind === 'live-place' &&
      (intent.kind === 'plan-buy' || intent.kind === 'plan-sell')
    ) {
      const market = intent.market;
      const baseCurrency = market.split('-')[1] ?? market;
      const qty = intent.kind === 'plan-sell' ? Number(intent.quantity) : 0;
      const price = intent.kind === 'plan-sell' ? Number(intent.limitPrice) : 0;
      const krwAmount = intent.kind === 'plan-buy' ? Number(intent.krwAmount) : 0;
      notifyTrade({
        pdno: market,
        side: intent.kind === 'plan-buy' ? 'buy' : 'sell',
        qty: qty > 0 ? qty : krwAmount,
        price,
        qtyUnit: intent.kind === 'plan-buy' ? ' KRW' : ` ${baseCurrency}`,
      });
    }
    return result.value;
  }),

  startAuto: runtimeProcedure.input(AutoStartInputSchema).mutation(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    const repo = new CryptoAutoTradingRepo(ctx.db);
    const config = repo.getConfig(accountId, input.market);
    if (config.mode === 'live-small') {
      const gate = createCryptoAutoService(ctx).getGate({
        accountId,
        market: input.market,
        requireIdempotency: false,
      });
      if (gate.isErr()) throwUpbitError(gate.error);
      if (!gate.value.ok) {
        throwUpbitError({
          kind: 'VALIDATION',
          message: gate.value.blockedReasons.join(', ') || 'live gate가 차단되었습니다.',
        });
      }
    }
    stopCryptoAutoJob(accountId, input.market);
    const key = cryptoAutoJobKey(accountId, input.market);
    const job: CryptoAutoJob = {
      running: false,
      timer: setInterval(() => {
        const current = cryptoAutoJobs.get(key);
        if (!current || current.running) return;
        current.running = true;
        void readAutoTickInputs(ctx, { accountId, market: input.market })
          .then(async (tick) => {
            const config = new CryptoAutoTradingRepo(ctx.db).getConfig(accountId, input.market);
            if (config.mode === 'live-small') {
              const result = await createCryptoAutoService(ctx).runLiveTick({
                accountId,
                market: input.market,
                balances: tick.balances,
                tradePrice: tick.tradePrice,
                adapter: tick.privateAdapter,
              });
              if (result.isOk())
                persistAutoOrderIfPresent(ctx, accountId, result.value.event.result);
            } else {
              createCryptoAutoService(ctx).runDryTick({
                accountId,
                market: input.market,
                balances: tick.balances,
                tradePrice: tick.tradePrice,
              });
            }
          })
          .catch((cause) => {
            ctx.logger.log({
              level: 'ERROR',
              category: 'ORDER',
              message: 'crypto.auto.loop.failed',
              payload: {
                accountId,
                market: input.market,
                cause: cause instanceof Error ? cause.message : String(cause),
              },
            });
          })
          .finally(() => {
            const latest = cryptoAutoJobs.get(key);
            if (latest) latest.running = false;
          });
      }, input.intervalMs),
    };
    cryptoAutoJobs.set(key, job);
    return { accountId, market: input.market, running: true as const };
  }),

  stopAuto: runtimeProcedure.input(AutoMarketInputSchema).mutation(({ ctx, input }) => {
    const accountId = activeAccountIdOrThrow(ctx, input.accountId);
    loadPrivateUpbitCredentials(ctx, accountId);
    return { accountId, market: input.market, stopped: stopCryptoAutoJob(accountId, input.market) };
  }),

  placeOrder: runtimeProcedure
    .input(CryptoOrderIntentSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      // RALPLAN P6 A7: UPBIT KRW 마켓 지정가는 호가단위 위반 시 API rejection.
      // side에 따라 floor(매수=낮게)/ceil(매도=높게)로 보정해 주문가 미체결 위험을 줄인다.
      const corrected =
        input.ordType === 'limit' && input.price && input.market.startsWith('KRW-')
          ? {
              ...input,
              price: normalizeUpbitKrwLimitPrice(
                input.price,
                input.side === 'bid' ? 'floor' : 'ceil',
              ),
            }
          : input;
      const adapter = createPrivateUpbit(ctx, input.accountId);
      const result = await adapter.createOrder(corrected);
      if (result.isErr()) throwUpbitError(result.error);
      new CryptoTradingRepo(ctx.db).upsertOrder({
        accountId: input.accountId,
        exchange: 'UPBIT',
        order: result.value,
      });
      // RALPLAN P6 #3 — 매뉴얼 매수에도 RateGuard 적용. 윈도우 내 임계 초과 시 SafetyState.master=false.
      // 자동매매 runLiveTick 과 동일한 broker-agnostic RateGuard 인스턴스 공유.
      if (corrected.side === 'bid' && ctx.rateGuard) {
        ctx.rateGuard.recordBuy(input.accountId, corrected.market, Date.now());
        const guard = ctx.rateGuard.checkAndPossiblyDisableAuto(input.accountId);
        if (guard.switchedToManual) {
          ctx.logger.log({
            level: 'WARN',
            category: 'ORDER',
            message: 'crypto.manual.rate-guard.disabled',
            payload: { accountId: input.accountId, market: corrected.market },
          });
        }
      }
      // RALPLAN P6 A4 — UPBIT 지정가 주문은 호가 미체결 시 timeout 후 자동취소.
      // 'price'(시장가 매수)/'market'(시장가 매도)는 즉시 체결되므로 등록 대상 아님.
      if (corrected.ordType === 'limit' && ctx.cryptoPendingOrderWatcher && result.value.uuid) {
        ctx.cryptoPendingOrderWatcher.register({
          pdno: corrected.market,
          side: corrected.side === 'bid' ? 'BUY' : 'SELL',
          nth: Date.now(),
          odno: result.value.uuid,
          accountId: input.accountId,
          ...(corrected.volume ? { qty: Number(corrected.volume) } : {}),
        });
      }
      ctx.logger.log({
        level: 'WARN',
        category: 'ORDER',
        message: 'crypto.upbit.order.placed',
        payload: {
          accountId: input.accountId,
          market: input.market,
          side: input.side,
          ordType: input.ordType,
          requestedPrice: input.price,
          actualPrice: corrected.price,
          uuid: result.value.uuid,
        },
      });
      // RALPLAN P6 #6 — 매뉴얼 코인 주문 체결 알림. (시장가 매수는 price 가 KRW 금액이라 0 으로 처리)
      const baseCurrency = corrected.market.split('-')[1] ?? corrected.market;
      const qty = Number(corrected.volume ?? '0');
      const priceNum = corrected.ordType === 'limit' ? Number(corrected.price ?? '0') : 0;
      if (qty > 0 || priceNum > 0) {
        notifyTrade({
          pdno: corrected.market,
          side: corrected.side === 'bid' ? 'buy' : 'sell',
          qty,
          price: priceNum,
          qtyUnit: ` ${baseCurrency}`,
        });
      }
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
      // RALPLAN P6 A4 — 사용자 취소 시 미체결 자동취소 watcher에서 해당 항목 제거.
      // (uuid 기준으로 매칭되는 모든 entry 해제 — listActive 순회는 비용이 적음.)
      if (ctx.cryptoPendingOrderWatcher) {
        for (const entry of ctx.cryptoPendingOrderWatcher.listActive()) {
          if (entry.odno === result.value.uuid) {
            ctx.cryptoPendingOrderWatcher.cancel({
              pdno: entry.pdno,
              side: entry.side,
              nth: entry.nth,
            });
          }
        }
      }
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

  getOrderDetail: runtimeProcedure
    .input(
      z.object({
        accountId: AccountIdField.optional(),
        uuid: z.string().trim().min(1),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = input.accountId ?? ctx.activeAccountId;
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
      const detail = new CryptoTradingRepo(ctx.db).getOrderDetail(accountId, input.uuid);
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '주문 상세를 찾을 수 없습니다.' });
      }
      return { accountId, order: detail };
    }),
});

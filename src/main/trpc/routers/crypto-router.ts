import {
  CryptoMarketCodeSchema,
  CryptoOrderIntentSchema,
  isUpbitCredentials,
} from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CryptoTradingRepo } from '../../crypto/crypto-repo';
import { UpbitExchangeAdapter } from '../../crypto/upbit/adapter';
import type { Context } from '../context';
import { publicProcedure, router, runtimeProcedure } from '../trpc-core';

const AccountIdField = z.number().int().positive();

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

function createPrivateUpbit(ctx: Context, accountId: number): UpbitExchangeAdapter {
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
  return new UpbitExchangeAdapter({
    accessKey: credentials.value.accessKey,
    secretKey: credentials.value.secretKey,
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

  getTicker: publicProcedure
    .input(z.object({ market: CryptoMarketCodeSchema }))
    .query(async ({ input }) => {
      const result = await createPublicUpbit().getTicker(input.market);
      if (result.isErr()) throwUpbitError(result.error);
      return result.value;
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

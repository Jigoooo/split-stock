import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ensureDailyCandles } from '../../ai/ensure-candles';
import { suggestStrategy } from '../../ai/suggest-strategy';
import { suggestSymbols } from '../../ai/suggest-symbols';
import type { Context } from '../context';
import { publicProcedure, router } from '../trpc-core';

/**
 * AI 추천 전 KIS 일봉 캐시 보충 콜백 빌더.
 * env/credentials 미준비 시 silently skip — 추천 자체는 캐시만으로 진행.
 */
function buildEnsureCandles(ctx: Context): (pdnos: ReadonlyArray<string>) => Promise<void> {
  return async (pdnos) => {
    if (!ctx.currentEnv || pdnos.length === 0) return;
    await ensureDailyCandles({
      pdnos,
      candlesRepo: ctx.candlesRepo,
      httpByEnv: ctx.httpByEnv,
      auth: ctx.auth,
      credentialsRepo: ctx.credentialsRepo,
      env: ctx.currentEnv,
      logger: ctx.logger,
    });
  };
}

const ProviderSchema = z.enum(['openai', 'anthropic']);

const AiConfigViewSchema = z.object({
  id: z.number().int().positive(),
  provider: ProviderSchema,
  model: z.string(),
  apiKeyMasked: z.string(),
  isDefault: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const aiRouter = router({
  /**
   * 등록된 AI 키 목록 — 평문 키 반환 X. masked + meta 만.
   */
  listConfigs: publicProcedure.query(({ ctx }) => {
    if (!ctx.aiCredentialsRepo) return { configs: [] };
    const configs = ctx.aiCredentialsRepo.list();
    return {
      configs: configs.map((c) => AiConfigViewSchema.parse(c)),
    };
  }),

  createConfig: publicProcedure
    .input(
      z.object({
        provider: ProviderSchema,
        model: z.string().min(1).max(120),
        apiKey: z.string().min(8).max(500),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      try {
        return ctx.aiCredentialsRepo.create(input);
      } catch (cause) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  updateConfig: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        provider: ProviderSchema.optional(),
        model: z.string().min(1).max(120).optional(),
        /** 빈 문자열은 거부 (수정 모드에서 키 미입력 = undefined). */
        apiKey: z.string().min(8).max(500).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      try {
        return ctx.aiCredentialsRepo.update(input);
      } catch (cause) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  deleteConfig: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      ctx.aiCredentialsRepo.delete(input.id);
      return { ok: true as const };
    }),

  setDefault: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      try {
        return ctx.aiCredentialsRepo.setDefault(input.id);
      } catch (cause) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  /**
   * 키 유효성 ping — 짧은 LLM 호출 1회. 실패 시 메시지 반환.
   */
  testConnection: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo || !ctx.llmClient) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 모듈 미초기화' });
      }
      const config = ctx.aiCredentialsRepo.getWithKey(input.id);
      if (!config) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI config 미존재' });
      }
      try {
        await ctx.llmClient.ping(config);
        return { ok: true as const };
      } catch (cause) {
        return {
          ok: false as const,
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }),

  /**
   * Phase 2 — 종목별 매직스플릿 strategy 추천.
   *
   * 일봉 60/120일 통계 + DART 최근 공시(있으면) 를 LLM 컨텍스트로 주입해
   * maxStages / 차수별 triggerDropPct + amountKrw + targetProfitPct 를 추천.
   */
  suggestStrategy: publicProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/, 'pdno 는 6자리 숫자'),
        desiredStages: z.number().int().min(2).max(10).optional(),
        corpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo || !ctx.llmClient || !ctx.dartClient) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 모듈 미초기화' });
      }
      // corpCode 자동 lookup — 사용자 입력이 우선, 없으면 dartCorpCodeRepo 매핑.
      let resolvedCorpCode = input.corpCode;
      if (!resolvedCorpCode && ctx.dartCorpCodeRepo?.isAvailable()) {
        const mapped = ctx.dartCorpCodeRepo.findByStockCode(input.pdno);
        if (mapped) resolvedCorpCode = mapped.corpCode;
      }

      try {
        return await suggestStrategy({
          pdno: input.pdno,
          candlesRepo: ctx.candlesRepo,
          stockMasterRepo: ctx.stockMasterRepo,
          aiCredentialsRepo: ctx.aiCredentialsRepo,
          llmClient: ctx.llmClient,
          dartClient: ctx.dartClient,
          logger: ctx.logger,
          ensureCandles: buildEnsureCandles(ctx),
          ...(input.desiredStages !== undefined ? { desiredStages: input.desiredStages } : {}),
          ...(resolvedCorpCode !== undefined ? { corpCode: resolvedCorpCode } : {}),
        });
      } catch (cause) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  /**
   * DART corpCode 매핑 sync — OpenDART 의 corpCode.xml 을 다운받아 stock_code → corp_code 적재.
   * 30일 캐시 후 재 sync. 한 번 받아두면 strategy 추천이 자동으로 공시 컨텍스트를 사용.
   */
  syncDartCorpCodes: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.dartCorpCodeRepo) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DART 모듈 미초기화' });
    }
    if (!ctx.dartCorpCodeRepo.isAvailable()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'DART_API_KEY 미설정 (빌드 임베드 환경변수 확인)',
      });
    }
    const result = await ctx.dartCorpCodeRepo.sync();
    return result;
  }),

  /**
   * DART corp_code 캐시 상태 확인 — UI 가 "갱신 필요" 표시할 때 사용.
   */
  getDartCorpCodeStatus: publicProcedure.query(({ ctx }) => {
    if (!ctx.dartCorpCodeRepo) return { available: false, stale: true };
    return {
      available: ctx.dartCorpCodeRepo.isAvailable(),
      stale: ctx.dartCorpCodeRepo.isStale(),
    };
  }),

  /**
   * Phase 1 — AI 매직스플릿 종목 추천.
   *
   * 후보 풀(보유 + 자동감시) 안에서 매직스플릿 적합도 Top N. 사용자 입력 0.
   * 활성 계좌 기준이며 계좌 미선택 시 BAD_REQUEST.
   */
  suggestSymbols: publicProcedure
    .input(z.object({ topN: z.number().int().min(1).max(10).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo || !ctx.llmClient) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 모듈 미초기화' });
      }
      if (ctx.activeAccountId === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '활성 계좌가 없습니다. 계좌를 먼저 선택하세요.',
        });
      }
      try {
        return await suggestSymbols({
          db: ctx.db,
          accountId: ctx.activeAccountId,
          candlesRepo: ctx.candlesRepo,
          aiCredentialsRepo: ctx.aiCredentialsRepo,
          llmClient: ctx.llmClient,
          logger: ctx.logger,
          ensureCandles: buildEnsureCandles(ctx),
          ...(input?.topN !== undefined ? { topN: input.topN } : {}),
        });
      } catch (cause) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),
});

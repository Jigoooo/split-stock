import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getAiRuntimeStatus } from '../../ai/ai-runtime-state';
import {
  suggestStrategyHandler,
  suggestSymbolsHandler,
} from '../handlers/ai-recommendation-handlers';
import { publicProcedure, router, runtimeReadyProcedure } from '../trpc-core';

const AI_CONFIG_LOCKED_MESSAGE =
  'AI 추천 분석이 진행 중입니다. 분석이 끝난 뒤 AI 키 설정을 변경하세요.';

function assertAiConfigMutable(): void {
  if (!getAiRuntimeStatus().isConfigLocked) return;
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: AI_CONFIG_LOCKED_MESSAGE,
  });
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
  listConfigs: publicProcedure.query(({ ctx }) => {
    if (!ctx.aiCredentialsRepo) return { configs: [] };
    const configs = ctx.aiCredentialsRepo.list();
    return {
      configs: configs.map((c) => AiConfigViewSchema.parse(c)),
    };
  }),

  getRuntimeStatus: publicProcedure.query(() => getAiRuntimeStatus()),

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
      assertAiConfigMutable();
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
        apiKey: z.string().min(8).max(500).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      assertAiConfigMutable();
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
      assertAiConfigMutable();
      ctx.aiCredentialsRepo.delete(input.id);
      return { ok: true as const };
    }),

  setDefault: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.aiCredentialsRepo) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 저장소 미초기화' });
      }
      assertAiConfigMutable();
      try {
        return ctx.aiCredentialsRepo.setDefault(input.id);
      } catch (cause) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  testConnection: runtimeReadyProcedure
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

  suggestStrategy: runtimeReadyProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/, 'pdno 는 6자리 숫자'),
        desiredStages: z.number().int().min(2).max(10).optional(),
        corpCode: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => suggestStrategyHandler(ctx, input)),

  syncDartCorpCodes: runtimeReadyProcedure.mutation(async ({ ctx }) => {
    if (!ctx.dartCorpCodeRepo) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'DART 모듈 미초기화' });
    }
    if (!ctx.dartCorpCodeRepo.isAvailable()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'DART_API_KEY 미설정 (빌드 임베드 환경변수 확인)',
      });
    }
    return await ctx.dartCorpCodeRepo.sync();
  }),

  getDartCorpCodeStatus: publicProcedure.query(({ ctx }) => {
    if (!ctx.dartCorpCodeRepo) return { available: false, stale: true };
    return {
      available: ctx.dartCorpCodeRepo.isAvailable(),
      stale: ctx.dartCorpCodeRepo.isStale(),
    };
  }),

  getMarketContextStatus: publicProcedure.query(({ ctx }) => {
    if (!ctx.marketContextService) {
      return {
        krx: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
        ecos: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
      };
    }
    return ctx.marketContextService.getStatus();
  }),

  refreshMarketContext: runtimeReadyProcedure
    .input(
      z
        .object({
          pdnos: z
            .array(z.string().regex(/^\d{6}$/))
            .max(30)
            .optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.marketContextService) {
        return {
          krxInserted: 0,
          ecosInserted: 0,
          status: {
            krx: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
            ecos: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
          },
        };
      }
      const krx = await ctx.marketContextService.refreshKrxForPdnos(
        input?.pdnos && input.pdnos.length > 0 ? input.pdnos : ['005930'],
      );
      const ecos = await ctx.marketContextService.refreshDefaultEcosSeries();
      return {
        krxInserted: krx.inserted,
        ecosInserted: ecos.inserted,
        status: ctx.marketContextService.getStatus(),
      };
    }),

  suggestSymbols: runtimeReadyProcedure
    .input(
      z
        .object({
          topN: z.number().int().min(1).max(10).optional(),
          extraPdnos: z
            .array(z.string().regex(/^\d{6}$/))
            .max(10)
            .optional(),
          aiOff: z.boolean().optional(),
          includeAutoDiscovery: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(({ ctx, input }) => suggestSymbolsHandler(ctx, input)),
});

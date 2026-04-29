import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getAiRuntimeStatus, runWithAiRuntimeOperation } from '../../ai/ai-runtime-state';
import { ensureDailyCandles } from '../../ai/ensure-candles';
import type { NaverSearchTrendSummary } from '../../ai/naver-datalab-client';
import { collectNewsEvidence, DEFAULT_MAX_SYMBOLS_PER_PASS } from '../../ai/news-evidence';
import type { NewsItem } from '../../ai/news-fetcher';
import { suggestStrategy } from '../../ai/suggest-strategy';
import { buildRankedMarketContext, suggestSymbols } from '../../ai/suggest-symbols';
import type { Context } from '../context';
import { publicProcedure, router } from '../trpc-core';

/**
 * AI 추천 전 KIS 일봉 캐시 보충 콜백 빌더.
 * env/credentials 미준비 시 silently skip — 추천 자체는 캐시만으로 진행.
 */
function buildEnsureCandles(ctx: Context): (pdnos: ReadonlyArray<string>) => Promise<void> {
  return async (pdnos) => {
    if (!ctx.currentEnv || pdnos.length === 0) return;
    const accountId = ctx.activeAccountId;
    const broker = accountId !== null ? ctx.brokerForAccount(accountId) : null;
    await ensureDailyCandles({
      pdnos,
      candlesRepo: ctx.candlesRepo,
      broker,
      logger: ctx.logger,
    });
  };
}

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

  /**
   * AI 분석 런타임 상태. 추천 분석 중에는 기본 AI 키 변경/삭제 같은 설정 변경을 막는다.
   */
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
        /** 빈 문자열은 거부 (수정 모드에서 키 미입력 = undefined). */
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
      const aiCredentialsRepo = ctx.aiCredentialsRepo;
      const llmClient = ctx.llmClient;
      const dartClient = ctx.dartClient;
      // corpCode 자동 lookup — 사용자 입력이 우선, 없으면 dartCorpCodeRepo 매핑.
      let resolvedCorpCode = input.corpCode;
      if (!resolvedCorpCode && ctx.dartCorpCodeRepo?.isAvailable()) {
        const mapped = ctx.dartCorpCodeRepo.findByStockCode(input.pdno);
        if (mapped) resolvedCorpCode = mapped.corpCode;
      }

      try {
        return await runWithAiRuntimeOperation('strategyRecommendation', async () => {
          const marketSnapshot = ctx.marketContextService
            ? await ctx.marketContextService.getContextForPdnos([input.pdno])
            : null;
          const stockName = ctx.stockMasterRepo.find(input.pdno)?.name ?? input.pdno;
          const newsFetcher = ctx.newsFetcher;
          const searchTrend = ctx.naverDatalabClient?.isAvailable()
            ? await getSingleSearchTrend(ctx.naverDatalabClient, input.pdno, stockName)
            : undefined;
          const newsEvidence = newsFetcher?.isAvailable()
            ? await collectNewsEvidence({
                pdno: input.pdno,
                name: stockName,
                search: (options) => newsFetcher.search(options),
              })
            : undefined;
          return suggestStrategy({
            pdno: input.pdno,
            candlesRepo: ctx.candlesRepo,
            stockMasterRepo: ctx.stockMasterRepo,
            aiCredentialsRepo,
            llmClient,
            dartClient,
            logger: ctx.logger,
            ensureCandles: buildEnsureCandles(ctx),
            ...(input.desiredStages !== undefined ? { desiredStages: input.desiredStages } : {}),
            ...(resolvedCorpCode !== undefined ? { corpCode: resolvedCorpCode } : {}),
            ...(newsEvidence !== undefined ? { newsEvidence } : {}),
            ...(searchTrend !== undefined ? { searchTrend } : {}),
            marketContext: buildRankedMarketContext(input.pdno, marketSnapshot),
          });
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
   * KRX/ECOS 시장 컨텍스트 상태 — 키/캐시/오류 상태만 노출하고 추천은 캐시된 값만 사용.
   */
  getMarketContextStatus: publicProcedure.query(({ ctx }) => {
    if (!ctx.marketContextService) {
      return {
        krx: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
        ecos: { isAvailable: false, isStale: true, lastSuccessAt: null, lastError: null },
      };
    }
    return ctx.marketContextService.getStatus();
  }),

  /**
   * KRX/ECOS 시장 컨텍스트 수동 갱신. KRX 는 대상 pdno 가 있을 때만 호출하고,
   * ECOS 는 기본 매크로 시리즈만 refresh 한다.
   */
  refreshMarketContext: publicProcedure
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

  /**
   * Phase 1 — AI 매직스플릿 종목 추천.
   *
   * 후보 풀(보유 + 자동감시) 안에서 매직스플릿 적합도 Top N. 사용자 입력 0.
   * 활성 계좌 기준이며 계좌 미선택 시 BAD_REQUEST.
   */
  suggestSymbols: publicProcedure
    .input(
      z
        .object({
          topN: z.number().int().min(1).max(10).optional(),
          /** 사용자가 추가한 pdno 목록 (보유/감시 외 관심 종목). max 10. */
          extraPdnos: z
            .array(z.string().regex(/^\d{6}$/))
            .max(10)
            .optional(),
          /** AI 끄기 — LLM 호출 없이 알고리즘 신호만으로 ranking. 키 미설정 시 자동 fallback. */
          aiOff: z.boolean().optional(),
          /** 자동 발굴(D 풀) 포함 여부. 기본 true. UI 토글로 끌 수 있음. */
          includeAutoDiscovery: z.boolean().optional(),
        })
        .optional(),
    )
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
      const accountId = ctx.activeAccountId;
      const aiCredentialsRepo = ctx.aiCredentialsRepo;
      const llmClient = ctx.llmClient;
      // 알고리즘 상위 N (기본 8) 만 뉴스 fetch — Naver 일일 한도 + 응답 시간 트레이드오프.
      const newsFetcher = ctx.newsFetcher;
      const fetchNews =
        newsFetcher?.isAvailable() && input?.aiOff !== true
          ? async (candidates: ReadonlyArray<{ pdno: string; name: string }>) => {
              const map = new Map<string, ReadonlyArray<NewsItem>>();
              for (const c of candidates) {
                const news = await newsFetcher.searchByKeyword(c.name, 5);
                if (news.length > 0) map.set(c.pdno, news);
              }
              return map;
            }
          : undefined;
      const fetchNewsEvidence =
        newsFetcher?.isAvailable() && input?.aiOff !== true
          ? async (candidates: ReadonlyArray<{ pdno: string; name: string }>) => {
              const map = new Map<string, Awaited<ReturnType<typeof collectNewsEvidence>>>();
              for (const c of candidates.slice(0, DEFAULT_MAX_SYMBOLS_PER_PASS)) {
                const evidence = await collectNewsEvidence({
                  pdno: c.pdno,
                  name: c.name,
                  search: (options) => newsFetcher.search(options),
                });
                if (evidence.clusters.length > 0) map.set(c.pdno, evidence);
              }
              return map;
            }
          : undefined;
      // LLM tool: 추가 뉴스 검색 — 신뢰성 부족 시 능동 호출.
      const searchNewsTool =
        newsFetcher?.isAvailable() && input?.aiOff !== true
          ? async (query: string, max: number) => {
              return await newsFetcher.searchByKeyword(query, max);
            }
          : undefined;
      // LLM tool: DART 공시 검색 — 자사주매입/유상증자 등 매수 결정 영향 큰 이벤트.
      const dartClient = ctx.dartClient;
      const getDartDisclosuresTool =
        dartClient && input?.aiOff !== true
          ? async (corpCode: string, days: number) => {
              const items = await dartClient.listRecentDisclosures(corpCode, days, 10);
              return items.map((i) => ({
                date: i.rceptDt,
                title: i.reportNm,
                report: i.rceptNo,
              }));
            }
          : undefined;
      const marketContextService = ctx.marketContextService;
      const getMarketContextForPdnos = marketContextService
        ? async (pdnos: ReadonlyArray<string>) => {
            return await marketContextService.getContextForPdnos(pdnos);
          }
        : undefined;
      const naverDatalabClient = ctx.naverDatalabClient;
      const fetchSearchTrends =
        naverDatalabClient?.isAvailable() && input?.aiOff !== true
          ? async (candidates: ReadonlyArray<{ pdno: string; name: string }>) => {
              return await naverDatalabClient.getTrendSummaries(
                candidates.slice(0, DEFAULT_MAX_SYMBOLS_PER_PASS).map((candidate) => ({
                  key: candidate.pdno,
                  groupName: candidate.name,
                  keywords: [candidate.name],
                })),
                { days: 30, timeUnit: 'date' },
              );
            }
          : undefined;
      try {
        return await runWithAiRuntimeOperation('symbolRecommendation', async () =>
          suggestSymbols({
            db: ctx.db,
            accountId,
            candlesRepo: ctx.candlesRepo,
            aiCredentialsRepo,
            llmClient,
            logger: ctx.logger,
            ensureCandles: buildEnsureCandles(ctx),
            ...(input?.topN !== undefined ? { topN: input.topN } : {}),
            ...(input?.extraPdnos && input.extraPdnos.length > 0
              ? { extraPdnos: input.extraPdnos }
              : {}),
            ...(input?.aiOff === true ? { aiOff: true } : {}),
            ...(input?.includeAutoDiscovery !== undefined
              ? { includeAutoDiscovery: input.includeAutoDiscovery }
              : {}),
            ...(fetchNews ? { fetchNews } : {}),
            ...(fetchNewsEvidence ? { fetchNewsEvidence } : {}),
            ...(searchNewsTool ? { searchNewsTool } : {}),
            ...(getDartDisclosuresTool ? { getDartDisclosuresTool } : {}),
            ...(getMarketContextForPdnos ? { getMarketContextForPdnos } : {}),
            ...(fetchSearchTrends ? { fetchSearchTrends } : {}),
          }),
        );
      } catch (cause) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),
});

async function getSingleSearchTrend(
  client: NonNullable<Context['naverDatalabClient']>,
  pdno: string,
  name: string,
): Promise<NaverSearchTrendSummary | undefined> {
  const trends = await client.getTrendSummaries(
    [{ key: pdno, groupName: name, keywords: [name] }],
    { days: 30, timeUnit: 'date' },
  );
  return trends.get(pdno);
}

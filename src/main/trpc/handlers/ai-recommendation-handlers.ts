import { TRPCError } from '@trpc/server';
import { runWithAiRuntimeOperation } from '../../ai/ai-runtime-state';
import { discoverAutoCandidates as discoverAutoCandidatesForSymbols } from '../../ai/auto-discovery';
import { ensureDailyCandles } from '../../ai/ensure-candles';
import type { NaverSearchTrendSummary } from '../../ai/naver-datalab-client';
import { collectNewsEvidence, DEFAULT_MAX_SYMBOLS_PER_PASS } from '../../ai/news-evidence';
import type { NewsItem } from '../../ai/news-fetcher';
import { suggestStrategy } from '../../ai/suggest-strategy';
import { buildRankedMarketContext, suggestSymbols } from '../../ai/suggest-symbols';
import type { Context } from '../context';

export async function suggestStrategyHandler(
  ctx: Context,
  input: { pdno: string; desiredStages?: number | undefined; corpCode?: string | undefined },
) {
  if (!ctx.aiCredentialsRepo || !ctx.llmClient || !ctx.dartClient) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI 모듈 미초기화' });
  }
  const aiCredentialsRepo = ctx.aiCredentialsRepo;
  const llmClient = ctx.llmClient;
  const dartClient = ctx.dartClient;
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
      const datalabClient = ctx.naverDatalabClient;
      const searchTrend = datalabClient?.isAvailable()
        ? await safeOptionalContext(ctx.logger, 'naver-datalab', () =>
            getSingleSearchTrend(datalabClient, input.pdno, stockName),
          )
        : undefined;
      const newsEvidence = newsFetcher?.isAvailable()
        ? await safeOptionalContext(ctx.logger, 'naver-news', () =>
            collectNewsEvidence({
              pdno: input.pdno,
              name: stockName,
              search: (options) => newsFetcher.search(options),
            }),
          )
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
}

export async function suggestSymbolsHandler(
  ctx: Context,
  input:
    | {
        topN?: number | undefined;
        extraPdnos?: string[] | undefined;
        aiOff?: boolean | undefined;
        includeAutoDiscovery?: boolean | undefined;
      }
    | undefined,
) {
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
  const searchNewsTool =
    newsFetcher?.isAvailable() && input?.aiOff !== true
      ? async (query: string, max: number) => {
          return await newsFetcher.searchByKeyword(query, max);
        }
      : undefined;
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
        discoverAutoCandidates: (excludePdnos) =>
          discoverAutoCandidatesForSymbols({
            db: ctx.db,
            candlesRepo: ctx.candlesRepo,
            logger: ctx.logger,
            stockMasterSync: ctx.stockMasterSync,
            marketContextService: ctx.marketContextService,
            broker: ctx.brokerForAccount(accountId),
            excludePdnos,
          }),
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
}

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

async function safeOptionalContext<T>(
  logger: Context['logger'],
  source: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (cause) {
    logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.optional-context.failed',
      payload: {
        source,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    });
    return undefined;
  }
}

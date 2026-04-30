import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { AiCredentialsRepo, AiProviderConfigWithKey } from './ai-credentials-repo';
import { scoreToTier } from './algo/composite-score';
import type { ChatResponse, LlmClient } from './llm-client';
import type { NewsEvidencePack } from './news-evidence';
import { suggestSymbols } from './suggest-symbols';

const config: AiProviderConfigWithKey = {
  id: 1,
  provider: 'openai',
  model: 'test-model',
  apiKeyMasked: 'test****',
  apiKeyPlain: 'test-key',
  isDefault: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function createDb(names: Record<string, string>): Db {
  return {
    selectDistinct: () => ({
      from: () => ({
        where: () => ({
          all: () => [],
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => Object.entries(names).map(([pdno, name]) => ({ pdno, name })),
        }),
      }),
    }),
  } as unknown as Db;
}

function createRepo(count: number): DailyCandlesRepo {
  const candles = buildCandles('2026-01-01', count);
  return {
    getInRange(_pdno: string, _period: ChartPeriod, from: string, to: string): DailyCandle[] {
      return candles.filter((c) => c.date >= from && c.date <= to);
    },
    upsertMany(): number {
      return 0;
    },
  } as unknown as DailyCandlesRepo;
}

function buildCandles(start: string, count: number): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const close = 10_000 + Math.sin(i / 3) * 500;
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close - 100,
      high: close + 200,
      low: close - 200,
      close,
      volume: 300_000 + i * 1500,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

function baseInput(
  candleCount: number,
  overrides: Partial<Parameters<typeof suggestSymbols>[0]> = {},
): Parameters<typeof suggestSymbols>[0] {
  return {
    db: createDb({ '005930': '삼성전자' }),
    accountId: 1,
    candlesRepo: createRepo(candleCount),
    aiCredentialsRepo: { getDefaultWithKey: () => config } as unknown as AiCredentialsRepo,
    llmClient: { chat: vi.fn() } as unknown as LlmClient,
    logger: { log: vi.fn() } as unknown as EventLogger,
    extraPdnos: ['005930'],
    includeAutoDiscovery: false,
    topN: 8,
    ...overrides,
  };
}

function newsPack(): NewsEvidencePack {
  return {
    pdno: '005930',
    name: '삼성전자',
    queries: ['삼성전자'],
    rawCount: 2,
    uniqueCount: 1,
    clusters: [
      {
        id: 'news-1',
        title: '삼성전자 실적 개선',
        summary: '반도체 업황 개선 근거',
        latestPublishedAt: '2026-04-29 09:00',
        representative: [
          {
            publishedAt: '2026-04-29 09:00',
            title: '삼성전자 실적 개선',
            summary: '반도체 업황 개선 근거',
            link: 'https://news.example/1',
            sourceQuery: '삼성전자',
            sourceSort: 'date',
          },
        ],
        hiddenCount: 0,
      },
    ],
  };
}

describe('suggestSymbols', () => {
  it('filters blocked symbols when candle coverage is below 30', async () => {
    const result = await suggestSymbols(baseInput(20, { aiOff: true }));

    expect(result.ranked).toEqual([]);
    expect(result.userInputResults[0]).toMatchObject({
      pdno: '005930',
      dataQuality: 'blocked',
      tier: 'avoid',
      confidence: 'low',
    });
    expect(result.userInputResults[0]?.cons).toContain('일봉 30개 미만으로 자동 추천 차단');
    expect(result.emptyReason).toBeNull();
  });

  it('caps limited symbols in algorithm-only mode', async () => {
    const result = await suggestSymbols(baseInput(45, { aiOff: true }));

    expect(result.ranked[0]).toMatchObject({
      pdno: '005930',
      dataQuality: 'limited',
      confidence: 'low',
    });
    expect(result.ranked[0]?.score).toBeLessThanOrEqual(60);
    expect(result.ranked[0]?.tier).not.toBe('top');
    expect(result.ranked[0]?.tier).not.toBe('strong');
    expect(result.ranked[0]?.evidenceRefs.some((ref) => ref.kind === 'dataQuality')).toBe(true);
  });

  it('uses auto-discovered candidates when automatic discovery is enabled', async () => {
    const result = await suggestSymbols(
      baseInput(65, {
        aiOff: true,
        extraPdnos: [],
        includeAutoDiscovery: true,
        discoverAutoCandidates: async () => ({
          candidates: [{ pdno: '000660', name: 'SK하이닉스' }],
          diagnostics: {
            enabled: true,
            universeCount: 2,
            basisDate: '2026-04-28',
            seedCount: 1,
            candlesFetched: 65,
            candlesFailed: 0,
            candlesSkipped: false,
            screenedCount: 1,
            addedCount: 1,
            blockedCount: 0,
            conditionPassCounts: {
              score: 1,
              volatility: 1,
              range: 1,
              liquidity: 1,
              trendNeutrality: 1,
            },
            tierCounts: { top: 0, strong: 1, moderate: 0, watch: 0, avoid: 0 },
            lowestIncludedScore: 72,
            emptyReason: null,
            sources: [{ source: 'krx', status: 'used', count: 2, stale: false, reason: null }],
          },
        }),
      }),
    );

    expect(result.poolSize).toBe(1);
    expect(result.ranked[0]).toMatchObject({
      pdno: '000660',
      name: 'SK하이닉스',
      sources: ['AUTO'],
    });
    expect(result.diagnostics.discovery.addedCount).toBe(1);
  });

  it('caps LLM over-promotion to the deterministic algorithm anchor', async () => {
    const chat = vi.fn<LlmClient['chat']>().mockResolvedValue({
      parsed: {
        recommended: [
          {
            pdno: '005930',
            score: 100,
            tier: 'top',
            confidence: 'high',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: 'AI가 매우 강한 후보로 판단했습니다.',
            pros: ['AI 고평가'],
            cons: [],
            entryNote: null,
            consensusCount: 3,
            citedTools: [],
          },
        ],
        userInputResults: [],
      },
      text: '{}',
      toolCalls: [],
    } satisfies ChatResponse<unknown>);

    const result = await suggestSymbols(
      baseInput(65, {
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map(),
      }),
    );

    const item = result.ranked[0];
    expect(item).toBeDefined();
    if (!item) throw new Error('missing ranked item');
    expect(item.algoScore).not.toBeNull();
    expect(item.score).toBeLessThan(100);
    expect(item.score).toBeLessThanOrEqual((item.algoScore ?? 0) + 10);
    expect(item.tier).toBe(scoreToTier(item.score));
    expect(item.cons.some((reason) => reason.includes('AI 점수 상한 적용'))).toBe(true);
  });

  it('attaches news clusters to evidence refs for traceability', async () => {
    const chat = vi.fn<LlmClient['chat']>().mockResolvedValue({
      parsed: {
        recommended: [
          {
            pdno: '005930',
            score: 72,
            tier: 'strong',
            confidence: 'med',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: '뉴스와 지표가 우호적입니다.',
            pros: ['뉴스 긍정'],
            cons: [],
            entryNote: null,
            consensusCount: 3,
            citedTools: ['get_dart_disclosures'],
          },
        ],
        userInputResults: [],
      },
      text: '{}',
      toolCalls: [
        {
          name: 'get_dart_disclosures',
          args: { corpCode: '00126380', days: 30 },
          result: JSON.stringify([
            { date: '20260429', title: '잠정실적 공시', report: '영업이익 증가' },
          ]),
        },
      ],
    } satisfies ChatResponse<unknown>);
    const pack = newsPack();

    const result = await suggestSymbols(
      baseInput(65, {
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map([['005930', pack]]),
      }),
    );

    expect(result.ranked[0]?.newsClusters).toHaveLength(1);
    expect(result.ranked[0]?.evidenceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'news-1', kind: 'news' })]),
    );
    expect(result.ranked[0]?.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'disclosure', title: '잠정실적 공시' }),
      ]),
    );
  });
});

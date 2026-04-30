import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { AiCredentialsRepo, AiProviderConfigWithKey } from './ai-credentials-repo';
import { scoreToTier } from './algo/composite-score';
import { type AutoDiscoveryResult, selectKrxSeeds } from './auto-discovery';
import type { ChatResponse, LlmClient } from './llm-client';
import type { CachedKrxBaseInfo, CachedKrxDailyTrade } from './market-context-repo';
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
    topN: 12,
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

function krxRow(
  pdno: string,
  market: CachedKrxDailyTrade['market'],
  marketCap: number,
  tradeValue: number,
  changeRate = 2,
): CachedKrxDailyTrade {
  return {
    market,
    date: '2026-04-29',
    pdno,
    name: pdno,
    close: 10_000,
    change: 100,
    changeRate,
    open: 9_900,
    high: 10_200,
    low: 9_800,
    volume: 1_000_000,
    tradeValue,
    marketCap,
    listedShares: 1_000_000,
    fetchedAt: new Date('2026-04-29T00:00:00Z'),
  };
}

function baseInfoRow(
  pdno: string,
  market: CachedKrxBaseInfo['market'],
  stockKind: string | null,
): CachedKrxBaseInfo {
  return {
    market,
    date: '2026-04-29',
    isin: `KR7${pdno}003`,
    pdno,
    name: pdno,
    shortName: pdno,
    englishName: null,
    listedAt: null,
    marketName: market,
    securityGroup: '주권',
    section: null,
    stockKind,
    parValue: null,
    listedShares: null,
    fetchedAt: new Date('2026-04-29T00:00:00Z'),
  };
}

function autoDiscoveryResult(
  names: Record<string, string>,
  options: { universeCount?: number; basisDate?: string; candlesFetched?: number } = {},
): AutoDiscoveryResult {
  const candidates = Object.entries(names).map(([pdno, name]) => ({ pdno, name }));
  const count = candidates.length;
  const universeCount = options.universeCount ?? count;
  return {
    candidates,
    diagnostics: {
      enabled: true,
      universeCount,
      basisDate: options.basisDate ?? '2026-04-29',
      seedCount: count,
      candlesFetched: options.candlesFetched ?? 0,
      candlesFailed: 0,
      candlesSkipped: false,
      screenedCount: count,
      addedCount: count,
      blockedCount: 0,
      conditionPassCounts: {
        score: count,
        volatility: count,
        range: count,
        liquidity: count,
        trendNeutrality: count,
      },
      tierCounts: { top: 0, strong: count, moderate: 0, watch: 0, avoid: 0 },
      lowestIncludedScore: count > 0 ? 72 : null,
      emptyReason: null,
      sources: [
        { source: 'krx', status: 'used', count: universeCount, stale: false, reason: null },
      ],
    },
  };
}

describe('suggestSymbols', () => {
  it('selectKrxSeeds includes lower-ranked buckets before filling one dominant bucket', () => {
    const dominant = Array.from({ length: 6 }, (_, i) =>
      krxRow(String(100000 + i), 'KOSPI', 50_000_000_000_000, 200_000_000_000),
    );
    const diversified = [
      krxRow('200001', 'KOSDAQ', 90_000_000_000, 2_000_000_000, 3),
      krxRow('200002', 'KOSDAQ', 700_000_000_000, 8_000_000_000, 1),
    ];

    const selected = selectKrxSeeds([...dominant, ...diversified], new Set(), 4);

    expect(selected).toHaveLength(4);
    expect(selected.some((row) => row.market === 'KOSDAQ')).toBe(true);
    expect(
      new Set(selected.map((row) => `${row.market}:${row.marketCap}:${row.tradeValue}`)).size,
    ).toBeGreaterThan(1);
  });

  it('selectKrxSeeds keeps the hard trade value floor at 100m KRW', () => {
    const selected = selectKrxSeeds(
      [
        krxRow('200001', 'KOSDAQ', 90_000_000_000, 90_000_000),
        krxRow('200002', 'KOSDAQ', 90_000_000_000, 150_000_000),
      ],
      new Set(),
      10,
    );

    expect(selected.map((row) => row.pdno)).toEqual(['200002']);
  });

  it('selectKrxSeeds prevents 10b-plus trade value mega caps from monopolizing seeds', () => {
    const highTradeMegaCaps = Array.from({ length: 12 }, (_, i) =>
      krxRow(String(310000 + i), 'KOSPI', 80_000_000_000_000, 300_000_000_000),
    );
    const diversified = [
      krxRow('320001', 'KOSDAQ', 80_000_000_000, 150_000_000),
      krxRow('320002', 'KOSDAQ', 600_000_000_000, 700_000_000),
      krxRow('320003', 'KOSDAQ', 2_000_000_000_000, 3_000_000_000),
      krxRow('320004', 'KOSDAQ', 12_000_000_000_000, 12_000_000_000),
      krxRow('320005', 'KOSPI', 70_000_000_000, 700_000_000),
    ];

    const selected = selectKrxSeeds([...highTradeMegaCaps, ...diversified], new Set(), 8);
    const selectedCompositeBuckets = new Set(
      selected.map((row) => `${row.market}:${row.marketCap}:${row.tradeValue}`),
    );
    const dominantPdnos = new Set(highTradeMegaCaps.map((row) => row.pdno));

    expect(selected).toHaveLength(8);
    expect(selected.filter((row) => dominantPdnos.has(row.pdno))).toHaveLength(3);
    expect(selected.some((row) => row.market === 'KOSDAQ')).toBe(true);
    expect(selectedCompositeBuckets.size).toBeGreaterThanOrEqual(4);
  });

  it('selectKrxSeeds uses base info to block non-common stocks without blocking missing base info', () => {
    const rows = [
      krxRow('330001', 'KOSPI', 500_000_000_000, 600_000_000),
      krxRow('330002', 'KOSPI', 500_000_000_000, 700_000_000),
      krxRow('330003', 'KOSPI', 500_000_000_000, 800_000_000),
    ];
    const baseInfoByKey = new Map<string, CachedKrxBaseInfo>([
      ['KOSPI:330001', baseInfoRow('330001', 'KOSPI', '우선주')],
      ['KOSPI:330002', baseInfoRow('330002', 'KOSPI', '보통주')],
    ]);

    const selected = selectKrxSeeds(rows, new Set(), 10, { baseInfoByKey });

    expect(selected.map((row) => row.pdno).sort()).toEqual(['330002', '330003']);
  });

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

  it('caps limited manual symbols in algorithm-only mode', async () => {
    const result = await suggestSymbols(baseInput(45, { aiOff: true }));

    expect(result.ranked).toEqual([]);
    expect(result.userInputResults[0]).toMatchObject({
      pdno: '005930',
      dataQuality: 'limited',
      confidence: 'low',
    });
    expect(result.userInputResults[0]?.score).toBeLessThanOrEqual(60);
    expect(result.userInputResults[0]?.tier).not.toBe('top');
    expect(result.userInputResults[0]?.tier).not.toBe('strong');
    expect(result.userInputResults[0]?.evidenceRefs.some((ref) => ref.kind === 'dataQuality')).toBe(
      true,
    );
  });

  it('uses auto-discovered candidates when automatic discovery is enabled', async () => {
    const result = await suggestSymbols(
      baseInput(65, {
        aiOff: true,
        extraPdnos: [],
        includeAutoDiscovery: true,
        discoverAutoCandidates: async () =>
          autoDiscoveryResult(
            { '000660': 'SK하이닉스' },
            { universeCount: 2, basisDate: '2026-04-28', candlesFetched: 65 },
          ),
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

  it('defaults to 12 recommendations and fills narrow LLM output with algorithmic candidates', async () => {
    const names = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const pdno = String(100000 + i);
        return [pdno, `테스트${i}`];
      }),
    );
    const firstPdno = Object.keys(names)[0] as string;
    const chat = vi.fn<LlmClient['chat']>().mockResolvedValue({
      parsed: {
        recommended: [
          {
            pdno: firstPdno,
            score: 72,
            tier: 'strong',
            confidence: 'med',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: 'LLM이 한 종목만 반환했습니다.',
            pros: ['후보 1개'],
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

    const input = baseInput(65, {
      db: createDb(names),
      extraPdnos: [],
      includeAutoDiscovery: true,
      llmClient: { chat } as unknown as LlmClient,
      fetchNewsEvidence: async () => new Map(),
      discoverAutoCandidates: async () => autoDiscoveryResult(names),
    });
    delete input.topN;

    const result = await suggestSymbols(input);

    expect(result.ranked).toHaveLength(12);
    expect(new Set(result.ranked.map((item) => item.pdno)).size).toBe(12);
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining('상위 12개') }),
        ]),
      }),
    );
  });

  it('algorithm-only default returns 12 recommendations when topN is omitted', async () => {
    const names = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const pdno = String(110000 + i);
        return [pdno, `알고${i}`];
      }),
    );
    const input = baseInput(65, {
      db: createDb(names),
      extraPdnos: [],
      aiOff: true,
      includeAutoDiscovery: true,
      discoverAutoCandidates: async () => autoDiscoveryResult(names),
    });
    delete input.topN;

    const result = await suggestSymbols(input);

    expect(result.ranked).toHaveLength(12);
    expect(result.userInputResults).toHaveLength(0);
  });

  it('keeps manual extras out of recommended even if the LLM returns them there', async () => {
    const names = {
      '005930': '삼성전자',
      ...Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => {
          const pdno = String(120000 + i);
          return [pdno, `자동${i}`];
        }),
      ),
    };
    const chat = vi.fn<LlmClient['chat']>().mockResolvedValue({
      parsed: {
        recommended: [
          {
            pdno: '005930',
            score: 80,
            tier: 'strong',
            confidence: 'med',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: 'LLM이 manual extra를 recommended에 잘못 넣었습니다.',
            pros: [],
            cons: [],
            entryNote: null,
            consensusCount: 2,
            citedTools: [],
          },
          {
            pdno: '120000',
            score: 72,
            tier: 'strong',
            confidence: 'med',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: '정상 자동 후보입니다.',
            pros: [],
            cons: [],
            entryNote: null,
            consensusCount: 2,
            citedTools: [],
          },
        ],
        userInputResults: [
          {
            pdno: '005930',
            score: 60,
            tier: 'moderate',
            confidence: 'med',
            volatilityFit: 'mid',
            liquidityFit: 'good',
            summary: 'manual extra 별도 평가입니다.',
            pros: [],
            cons: [],
            entryNote: null,
            consensusCount: 2,
            citedTools: [],
          },
        ],
      },
      text: '{}',
      toolCalls: [],
    } satisfies ChatResponse<unknown>);
    const autoNames = Object.fromEntries(
      Object.entries(names).filter(([pdno]) => pdno !== '005930'),
    );

    const result = await suggestSymbols(
      baseInput(65, {
        db: createDb(names),
        topN: 3,
        extraPdnos: ['005930'],
        includeAutoDiscovery: true,
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map(),
        discoverAutoCandidates: async () => autoDiscoveryResult(autoNames),
      }),
    );

    expect(result.ranked.some((item) => item.pdno === '005930')).toBe(false);
    expect(result.userInputResults[0]?.pdno).toBe('005930');
  });

  it('keeps manual extras out of parse-fallback recommendations', async () => {
    const names = {
      '005930': '삼성전자',
      ...Object.fromEntries(
        Array.from({ length: 3 }, (_, i) => {
          const pdno = String(130000 + i);
          return [pdno, `파싱대체${i}`];
        }),
      ),
    };
    const autoNames = Object.fromEntries(
      Object.entries(names).filter(([pdno]) => pdno !== '005930'),
    );
    const chat = vi.fn<LlmClient['chat']>().mockResolvedValue({
      parsed: null,
      text: 'not json',
      toolCalls: [],
    } satisfies ChatResponse<unknown>);

    const result = await suggestSymbols(
      baseInput(65, {
        db: createDb(names),
        topN: 3,
        extraPdnos: ['005930'],
        includeAutoDiscovery: true,
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map(),
        discoverAutoCandidates: async () => autoDiscoveryResult(autoNames),
      }),
    );

    expect(result.ranked).toHaveLength(3);
    expect(result.ranked.some((item) => item.pdno === '005930')).toBe(false);
    expect(result.userInputResults[0]?.pdno).toBe('005930');
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
        extraPdnos: [],
        includeAutoDiscovery: true,
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map(),
        discoverAutoCandidates: async () => autoDiscoveryResult({ '005930': '삼성전자' }),
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
        extraPdnos: [],
        includeAutoDiscovery: true,
        llmClient: { chat } as unknown as LlmClient,
        fetchNewsEvidence: async () => new Map([['005930', pack]]),
        discoverAutoCandidates: async () => autoDiscoveryResult({ '005930': '삼성전자' }),
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

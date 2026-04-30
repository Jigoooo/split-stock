import { z } from 'zod';
import type { Db } from '../../db/client';
import type { EventLogger } from '../../logging/event-logger';
import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';
import type { AiCredentialsRepo } from '../ai-credentials-repo';
import type {
  ApiContextDiagnostic,
  AutoDiscoveryDiagnostics,
  AutoDiscoveryResult,
} from '../auto-discovery';
import type { LlmClient } from '../llm-client';
import type { MarketContextSnapshot } from '../market-context-service';
import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import type { NewsEvidencePack } from '../news-evidence';
import type { NewsItem } from '../news-fetcher';
import type { DataQuality, RangeCycleFacts } from '../range-cycle-facts';

export interface SuggestSymbolsInput {
  db: Db;
  accountId: number;
  candlesRepo: DailyCandlesRepo;
  aiCredentialsRepo: AiCredentialsRepo;
  llmClient: LlmClient;
  logger: EventLogger;
  /** 후보 풀 cap. 기본 30. */
  poolCap?: number;
  /** 응답 Top N (recommended 분배). 기본 12. */
  topN?: number;
  /** 사용자가 stock-picker 등으로 추가한 pdno 목록. */
  extraPdnos?: ReadonlyArray<string>;
  /** D 풀(자동 발굴) 포함 여부. 기본 true. */
  includeAutoDiscovery?: boolean;
  /** 후보 pdno 목록의 일봉 캐시를 사전 보충. */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
  /** 종목별 최신 뉴스 fetch 콜백. */
  fetchNews?: (
    candidates: ReadonlyArray<{ pdno: string; name: string }>,
  ) => Promise<Map<string, ReadonlyArray<NewsItem>>>;
  fetchNewsEvidence?: (
    candidates: ReadonlyArray<{ pdno: string; name: string }>,
  ) => Promise<Map<string, NewsEvidencePack>>;
  /** Naver DataLab 검색어 트렌드. */
  fetchSearchTrends?: (
    candidates: ReadonlyArray<{ pdno: string; name: string }>,
  ) => Promise<Map<string, NaverSearchTrendSummary>>;
  /** Tool: search_news 콜백. */
  searchNewsTool?: (query: string, max: number) => Promise<ReadonlyArray<NewsItem>>;
  /** Tool: DART 공시 콜백. */
  getDartDisclosuresTool?: (
    corpCode: string,
    days: number,
  ) => Promise<ReadonlyArray<{ date: string; title: string; report: string }>>;
  /** KRX/ECOS 캐시 기반 시장 컨텍스트. */
  getMarketContextForPdnos?: (pdnos: ReadonlyArray<string>) => Promise<MarketContextSnapshot>;
  discoverAutoCandidates?: (excludePdnos: ReadonlySet<string>) => Promise<AutoDiscoveryResult>;
  /** AI 끄기 모드. */
  aiOff?: boolean;
}

const TierSchema = z.enum(['top', 'strong', 'moderate', 'watch', 'avoid']);
const ConfidenceSchema = z.enum(['high', 'med', 'low']);

export const RankedItemSchema = z.object({
  pdno: z.string(),
  score: z.number().min(0).max(100),
  tier: TierSchema,
  confidence: ConfidenceSchema,
  volatilityFit: z.enum(['low', 'mid', 'high']),
  liquidityFit: z.enum(['good', 'ok', 'poor']),
  summary: z.string().min(1),
  pros: z.array(z.string()).max(3).default([]),
  cons: z.array(z.string()).max(3).default([]),
  entryNote: z.string().nullable().default(null),
  consensusCount: z.number().int().min(0).max(10).default(0),
  citedTools: z.array(z.string()).default([]),
});

export const SuggestionResponseSchema = z.object({
  recommended: z.array(RankedItemSchema),
  userInputResults: z.array(RankedItemSchema).default([]),
});

export type RankedItem = z.infer<typeof RankedItemSchema>;

export interface RankedSymbolStats {
  lastClose: number | null;
  volatility60d: number | null;
  avgVolume60d: number | null;
  rangePct120d: number | null;
}

export interface RankedMarketContext {
  krx: {
    date: string;
    close: number | null;
    changeRate: number | null;
    volume: number | null;
    tradeValue: number | null;
    marketCap: number | null;
  } | null;
  ecos: ReadonlyArray<{
    indicator: string;
    date: string;
    value: number;
    unitName: string | null;
  }>;
  status: {
    krx: { isAvailable: boolean; isStale: boolean; lastError: string | null };
    ecos: { isAvailable: boolean; isStale: boolean; lastError: string | null };
  };
}

export type RankedSymbol = RankedItem & {
  /** 응답에 lookup 한 종목명. */
  name: string;
  /** 후보 출처 (보유/감시/수동/자동발굴). */
  sources: ReadonlyArray<'OWNED' | 'WATCH' | 'MANUAL' | 'AUTO'>;
  /** 통계 수치 — UI 에서 LLM 점수 근거를 직접 노출. */
  stats: RankedSymbolStats;
  /** KRX/ECOS 캐시 컨텍스트 — 보조 사실/리스크 플래그 전용. */
  marketContext: RankedMarketContext | null;
  /** 결정론적 알고리즘 점수 (0~100). */
  algoScore: number | null;
  /** 알고리즘 라벨. */
  algoLabels: ReadonlyArray<string>;
  /** AI 끄기 모드로 생성된 결과인지. */
  aiOff: boolean;
  /** LLM 이 참조한 뉴스 원본. */
  news: ReadonlyArray<NewsItem>;
  /** 알고리즘이 제시한 모순 신호. */
  conflicts: ReadonlyArray<string>;
  /** 지표별 사실 기반 사유. */
  indicatorReasons: ReadonlyArray<{ indicator: string; value: string; meaning: string }>;
  dataQuality: DataQuality;
  dataQualityReason: string;
  analysisConfidence: 'high' | 'med' | 'low';
  evidenceRefs: RangeCycleFacts['evidenceRefs'];
  globalRisks: ReadonlyArray<string>;
  newsClusters: ReadonlyArray<NewsEvidencePack['clusters'][number]>;
};

export interface SuggestSymbolsResult {
  ranked: RankedSymbol[];
  userInputResults: RankedSymbol[];
  distribution: {
    top: number;
    strong: number;
    moderate: number;
    watch: number;
    avoid: number;
  };
  poolSize: number;
  emptyReason: string | null;
  rejectedCount: number;
  durationMs: number;
  diagnostics: SuggestSymbolsDiagnostics;
}

export interface SuggestSymbolsDiagnostics {
  discovery: AutoDiscoveryDiagnostics;
  sources: ApiContextDiagnostic[];
}

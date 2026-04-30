import type { EventLogger } from '../../logging/event-logger';
import type { DailyCandlesRepo } from '../../trading/daily-candles-repo';
import type { StockMasterRepo } from '../../trading/stock-master-repo';
import type { AiCredentialsRepo } from '../ai-credentials-repo';
import type { DartClient } from '../dart-client';
import type { LlmClient } from '../llm-client';
import type { DataQuality } from '../magic-split-facts';
import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import type { NewsEvidencePack } from '../news-evidence';
import type { RankedMarketContext } from '../suggest-symbols';
import type { StrategySuggestion } from './schema';

export interface SuggestStrategyInput {
  pdno: string;
  candlesRepo: DailyCandlesRepo;
  stockMasterRepo: StockMasterRepo;
  aiCredentialsRepo: AiCredentialsRepo;
  llmClient: LlmClient;
  dartClient: DartClient;
  logger: EventLogger;
  /** 후보 차수 max — 기본 5. */
  desiredStages?: number;
  /** DART corp_code 입력 — 외부에서 주입 가능. */
  corpCode?: string;
  newsEvidence?: NewsEvidencePack;
  searchTrend?: NaverSearchTrendSummary;
  marketContext?: RankedMarketContext | null;
  /** 일봉 캐시 사전 보충 콜백. */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
}

export interface SuggestStrategyResult {
  suggestion: StrategySuggestion | null;
  emptyReason: string | null;
  durationMs: number;
  dataQuality?: DataQuality;
  dataQualityReason?: string;
}

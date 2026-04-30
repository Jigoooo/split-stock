import { buildRankedMarketContext } from './symbol-recommendation/market-context';
import { runSuggestSymbols } from './symbol-recommendation/suggest-symbols-flow';
import type { SuggestSymbolsInput, SuggestSymbolsResult } from './symbol-recommendation/types';

export type {
  RankedMarketContext,
  RankedSymbol,
  RankedSymbolStats,
  SuggestSymbolsDiagnostics,
  SuggestSymbolsInput,
  SuggestSymbolsResult,
} from './symbol-recommendation/types';
export { buildRankedMarketContext };

/**
 * AI 박스권 분할매매 적합 종목 추천.
 *
 * Public facade only: 후보 풀/컨텍스트/LLM/result mapping orchestration 은
 * symbol-recommendation 내부 모듈에 둔다.
 */
export async function suggestSymbols(input: SuggestSymbolsInput): Promise<SuggestSymbolsResult> {
  return runSuggestSymbols(input);
}

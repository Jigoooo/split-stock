import { runSuggestStrategy } from './strategy-suggestion/suggest-strategy-flow';
import type { SuggestStrategyInput, SuggestStrategyResult } from './strategy-suggestion/types';

export type { StrategySuggestion } from './strategy-suggestion/schema';
export type { SuggestStrategyInput, SuggestStrategyResult } from './strategy-suggestion/types';

/**
 * 종목별 매직스플릿 strategy 추천.
 *
 * Public facade only: schema/prompt/parsing/result mapping 은 strategy-suggestion 내부 모듈에 둔다.
 */
export async function suggestStrategy(input: SuggestStrategyInput): Promise<SuggestStrategyResult> {
  return runSuggestStrategy(input);
}

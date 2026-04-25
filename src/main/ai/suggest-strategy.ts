import { z } from 'zod';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { AiCredentialsRepo } from './ai-credentials-repo';
import type { DartClient } from './dart-client';
import type { LlmClient } from './llm-client';
import { computeSymbolStats } from './symbol-stats';

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
  /** DART corp_code 입력 — 외부에서 주입 가능 (corpCode lookup 미구현 시 fallback). */
  corpCode?: string;
}

const RawBuyRuleSchema = z.object({
  nth: z.number().int().min(1).max(50),
  /** 1차는 null. 2차+ 는 직전 차수 대비 하락률 (0.03 = 3%). */
  triggerDropPct: z.number().min(0.001).max(0.5).nullable(),
  /** 차수당 매수 금액 (원). */
  amountKrw: z.number().int().min(10000),
});
const RawSellRuleSchema = z.object({
  nth: z.number().int().min(1).max(50),
  targetProfitPct: z.number().min(0.005).max(0.5),
});

const StrategySuggestionSchema = z.object({
  maxStages: z.number().int().min(2).max(20),
  buyRules: z.array(RawBuyRuleSchema).min(2),
  sellRules: z.array(RawSellRuleSchema).min(2),
  reasoning: z.string().min(1).max(400),
});

export type StrategySuggestion = z.infer<typeof StrategySuggestionSchema>;

export interface SuggestStrategyResult {
  suggestion: StrategySuggestion | null;
  emptyReason: string | null;
  durationMs: number;
}

/**
 * 종목별 매직스플릿 strategy 추천.
 *
 * 흐름:
 *   1) 일봉(60/120일) 통계 산출 (변동성·평균거래량·박스권)
 *   2) DART 최근 30일 공시 제목 fetch (있으면 LLM 컨텍스트에 포함, 실패해도 진행)
 *   3) default AI config 로 LLM 호출 + JSON schema 강제
 *   4) 결과는 호출측에서 StrategyProfile 로 변환 후 validateProfile 통과 검증
 *
 * 주의:
 *   - 데이터 부족(일봉 캐시 < 30개) 시 emptyReason 만 반환 — LLM 비용 낭비 방지.
 *   - 응답 JSON 파싱 실패 시 retry 없이 emptyReason 으로 마무리.
 */
export async function suggestStrategy(input: SuggestStrategyInput): Promise<SuggestStrategyResult> {
  const startedAt = Date.now();
  const config = input.aiCredentialsRepo.getDefaultWithKey();
  if (!config) {
    return {
      suggestion: null,
      emptyReason: 'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 등록 후 다시 시도하세요.',
      durationMs: 0,
    };
  }

  const stat = computeSymbolStats({
    candlesRepo: input.candlesRepo,
    pdnos: [input.pdno],
  })[0];
  if (!stat || stat.dataReason) {
    return {
      suggestion: null,
      emptyReason: `일봉 캐시가 부족합니다 (${stat?.dataReason ?? 'no-data'}). 차트를 한 번 열어 봉을 받아온 뒤 재시도하세요.`,
      durationMs: Date.now() - startedAt,
    };
  }

  const stockMaster = input.stockMasterRepo.find(input.pdno);
  const stockName = stockMaster?.name ?? input.pdno;

  // DART — 실패해도 LLM 호출은 계속.
  let disclosuresLine = '';
  if (input.corpCode && input.dartClient.isAvailable()) {
    const recent = await input.dartClient.listRecentDisclosures(input.corpCode, 30, 8);
    if (recent.length > 0) {
      disclosuresLine = `\n최근 30일 공시(${recent.length}건):\n${recent.map((d) => `- ${d.rceptDt}: ${d.reportNm}`).join('\n')}`;
    }
  }

  const desiredStages = input.desiredStages ?? 5;
  const userPrompt = [
    `종목: ${stockName} (${input.pdno})`,
    `최근 종가: ${stat.lastClose ?? 'n/a'} 원`,
    `60일 연환산 변동성: ${stat.volatility60d ?? 'n/a'}%`,
    `60일 평균 거래량: ${stat.avgVolume60d ?? 'n/a'} 주`,
    `120일 박스권 폭: ${stat.rangePct120d ?? 'n/a'}%`,
    disclosuresLine,
    '',
    `위 통계를 기반으로 매직스플릿 ${desiredStages}차 전략을 설계해 주세요.`,
    '',
    '제약:',
    '- maxStages: 2~10 권장',
    '- buyRules[0].triggerDropPct 는 반드시 null (1차는 수동 진입)',
    '- buyRules[1..].triggerDropPct: 직전 차수 대비 하락률 (0.02 = 2%, 0.03 = 3% 등). 박스권 폭과 변동성에 비례하게 분포',
    '- amountKrw: 모든 차수 동일 또는 점증 (예: 차수 늘수록 더 큰 금액으로 평단가 빠르게 낮춤)',
    '- sellRules[i].targetProfitPct: 차수별 익절률. 보통 후순위 차수가 더 작은 익절(빠른 회수)',
    '- reasoning: 추천 근거 1~2 문장 (한국어, 400자 이내)',
    '',
    '응답 JSON schema:',
    '{"maxStages":int,"buyRules":[{"nth":int,"triggerDropPct":number|null,"amountKrw":int}],"sellRules":[{"nth":int,"targetProfitPct":number}],"reasoning":"..."}',
  ].join('\n');

  const result = await input.llmClient.chat({
    config,
    schema: StrategySuggestionSchema,
    schemaName: 'AiStrategySuggestion',
    maxOutputTokens: 1500,
    messages: [
      {
        role: 'system',
        content:
          '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 설계 보조입니다. 응답은 단일 JSON 객체로만 답하고, 차수 nth 는 1부터 maxStages 까지 순서대로 채우세요.',
      },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!result.parsed) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.parse-failed',
      payload: { rawChars: result.text.length, pdno: input.pdno },
    });
    return {
      suggestion: null,
      emptyReason: 'AI 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.',
      durationMs: Date.now() - startedAt,
    };
  }

  const suggestion = normalizeSuggestion(result.parsed);
  input.logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'ai.suggest-strategy.ok',
    payload: {
      pdno: input.pdno,
      provider: config.provider,
      model: config.model,
      maxStages: suggestion.maxStages,
      durationMs: Date.now() - startedAt,
    },
  });

  return {
    suggestion,
    emptyReason: null,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * LLM 응답을 정규화 — buyRules[0].triggerDropPct=null 강제, nth 정렬, maxStages 와 길이 일치.
 */
function normalizeSuggestion(raw: StrategySuggestion): StrategySuggestion {
  const sortedBuy = [...raw.buyRules].sort((a, b) => a.nth - b.nth);
  const sortedSell = [...raw.sellRules].sort((a, b) => a.nth - b.nth);
  if (sortedBuy.length > 0) {
    const first = sortedBuy[0];
    if (first) sortedBuy[0] = { ...first, nth: 1, triggerDropPct: null };
  }
  // nth 재라벨링 — LLM 이 비순차 응답해도 1..N 강제.
  for (let i = 0; i < sortedBuy.length; i++) {
    const item = sortedBuy[i];
    if (item) sortedBuy[i] = { ...item, nth: i + 1 };
  }
  for (let i = 0; i < sortedSell.length; i++) {
    const item = sortedSell[i];
    if (item) sortedSell[i] = { ...item, nth: i + 1 };
  }
  // maxStages 와 buyRules 길이 일치 — 부족하면 잘라내기.
  const maxStages = Math.min(raw.maxStages, sortedBuy.length, sortedSell.length);
  return {
    maxStages,
    buyRules: sortedBuy.slice(0, maxStages),
    sellRules: sortedSell.slice(0, maxStages),
    reasoning: raw.reasoning,
  };
}

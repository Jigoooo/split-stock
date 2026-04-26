import { z } from 'zod';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { AiCredentialsRepo } from './ai-credentials-repo';
import { buildCandidatePool, type CandidateEntry } from './build-candidate-pool';
import type { LlmClient } from './llm-client';
import { computeSymbolStats, type SymbolStat } from './symbol-stats';

export interface SuggestSymbolsInput {
  db: Db;
  accountId: number;
  candlesRepo: DailyCandlesRepo;
  aiCredentialsRepo: AiCredentialsRepo;
  llmClient: LlmClient;
  logger: EventLogger;
  /** 후보 풀 cap. 기본 30. */
  poolCap?: number;
  /** 응답 Top N. 기본 5. */
  topN?: number;
  /**
   * 후보 pdno 목록의 일봉 캐시를 사전 보충. 호출자(ai-router)가 KIS env/auth 컨텍스트를
   * 들고 ensure 콜백을 주입. 미주입 시 캐시만 사용 (기존 동작).
   */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
}

const RankedItemSchema = z.object({
  pdno: z.string(),
  score: z.number().min(0).max(100),
  volatilityFit: z.enum(['low', 'mid', 'high']),
  liquidityFit: z.enum(['good', 'ok', 'poor']),
  summary: z.string().min(1).max(120),
});

const SuggestionResponseSchema = z.object({
  ranked: z.array(RankedItemSchema),
});

export type RankedSymbol = z.infer<typeof RankedItemSchema> & {
  /** 응답에 lookup 한 종목명. */
  name: string;
};

export interface SuggestSymbolsResult {
  ranked: RankedSymbol[];
  /** 후보 풀 자체가 비었거나 default 키 미설정 시 사유. */
  emptyReason: string | null;
  /** LLM 응답 중 풀 외 pdno 가 있어 silently 제거된 개수. */
  rejectedCount: number;
  /** LLM 호출 식별자 — 디버깅용. */
  durationMs: number;
}

/**
 * AI 매직스플릿 적합 종목 추천.
 *
 * 흐름:
 *   1) 후보 풀 빌드 (보유 + 자동감시) → cap=30
 *   2) 각 pdno 의 60/120일 통계 산출
 *   3) default AI config 로 LLM 호출 — 풀 외 pdno 응답은 silently reject
 *   4) Top N (기본 5) 반환
 *
 * Hallucination 방지:
 *   - 응답 pdno 화이트리스트 검증 (rejectedCount 카운트)
 *   - schema 강제 + zod 파싱 실패 시 빈 ranked
 */
export async function suggestSymbols(input: SuggestSymbolsInput): Promise<SuggestSymbolsResult> {
  const startedAt = Date.now();
  const config = input.aiCredentialsRepo.getDefaultWithKey();
  if (!config) {
    return {
      ranked: [],
      emptyReason: 'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 키를 등록하세요.',
      rejectedCount: 0,
      durationMs: 0,
    };
  }

  const pool = buildCandidatePool({
    db: input.db,
    accountId: input.accountId,
    cap: input.poolCap ?? 30,
  });
  if (pool.length === 0) {
    return {
      ranked: [],
      emptyReason:
        '후보 풀이 비었습니다. 보유 종목이 있거나 자동감시에 등록된 종목이 있어야 합니다.',
      rejectedCount: 0,
      durationMs: 0,
    };
  }

  // 일봉 캐시가 부족한 pdno 만 KIS fetch — 차트를 미리 열어둘 필요 없이 추천이 동작하도록.
  if (input.ensureCandles) {
    await input.ensureCandles(pool.map((p) => p.pdno));
  }

  const stats = computeSymbolStats({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
  });
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));

  const userPrompt = buildPrompt(pool, stats, input.topN ?? 5);

  const result = await input.llmClient.chat({
    config,
    schema: SuggestionResponseSchema,
    schemaName: 'AiSymbolSuggestion',
    maxOutputTokens: 1500,
    messages: [
      {
        role: 'system',
        content:
          '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 보조 분석가입니다. 후보 풀에 명시된 pdno 코드 안에서만 추천하세요. 풀 외 종목은 절대 응답에 포함하지 마세요.',
      },
      { role: 'user', content: userPrompt },
    ],
  });

  if (!result.parsed) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-symbols.parse-failed',
      payload: { rawChars: result.text.length },
    });
    return {
      ranked: [],
      emptyReason: 'AI 응답을 해석할 수 없습니다. 잠시 후 다시 시도하세요.',
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const allowedPdnos = new Set(pool.map((p) => p.pdno));
  const nameByPdno = new Map(pool.map((p) => [p.pdno, p.name]));
  let rejectedCount = 0;
  const ranked: RankedSymbol[] = [];
  for (const item of result.parsed.ranked) {
    if (!allowedPdnos.has(item.pdno)) {
      rejectedCount++;
      continue;
    }
    ranked.push({ ...item, name: nameByPdno.get(item.pdno) ?? item.pdno });
  }
  ranked.sort((a, b) => b.score - a.score);
  const topped = ranked.slice(0, input.topN ?? 5);

  input.logger.log({
    level: 'INFO',
    category: 'SYS',
    message: 'ai.suggest-symbols.ok',
    payload: {
      poolSize: pool.length,
      provider: config.provider,
      model: config.model,
      topN: topped.length,
      rejectedCount,
      durationMs: Date.now() - startedAt,
    },
  });

  // statsByPdno 는 디버깅 용도 — 결과에는 노출 X (renderer 가 필요시 별도 query).
  void statsByPdno;

  return {
    ranked: topped,
    emptyReason: topped.length === 0 ? '추천할 만한 종목이 없습니다.' : null,
    rejectedCount,
    durationMs: Date.now() - startedAt,
  };
}

function buildPrompt(
  pool: ReadonlyArray<CandidateEntry>,
  stats: ReadonlyArray<SymbolStat>,
  topN: number,
): string {
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));
  const lines: string[] = [];
  lines.push(`아래 ${pool.length}개 후보 종목 중 매직스플릿(분할매수/분할매도) 전략에 적합한`);
  lines.push(`상위 ${topN}개를 골라 점수와 한 줄 평을 제시해 주세요.`);
  lines.push('');
  lines.push('매직스플릿 적합도 판단 기준:');
  lines.push('- 변동성이 너무 낮으면 차수 진입 트리거 부족 (low fit), 너무 높으면 손실 위험');
  lines.push('- 거래량이 충분해야 슬리피지 방지');
  lines.push('- 박스권 폭이 적당하면 차수 간격 설계가 쉬움');
  lines.push('');
  lines.push('응답 JSON schema:');
  lines.push(
    '{"ranked":[{"pdno":"<후보 풀의 pdno>","score":0~100,"volatilityFit":"low|mid|high","liquidityFit":"good|ok|poor","summary":"한 줄 평(120자 이내)"}]}',
  );
  lines.push('');
  lines.push('후보 풀:');
  for (const c of pool) {
    const s = statsByPdno.get(c.pdno);
    const sourcesLabel = c.sources.join('+');
    if (!s || s.dataReason) {
      lines.push(
        `- ${c.pdno} (${c.name}) [${sourcesLabel}] — 통계 부족(${s?.dataReason ?? 'no-data'})`,
      );
      continue;
    }
    lines.push(
      `- ${c.pdno} (${c.name}) [${sourcesLabel}] — close=${s.lastClose}, vol60d=${s.volatility60d ?? 'n/a'}%, avgVol60d=${s.avgVolume60d ?? 'n/a'}, range120d=${s.rangePct120d ?? 'n/a'}%`,
    );
  }
  lines.push('');
  lines.push('주의: 후보 풀에 없는 pdno 는 응답에 포함하지 마세요.');
  return lines.join('\n');
}

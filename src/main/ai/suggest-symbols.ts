import { z } from 'zod';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { AiCredentialsRepo } from './ai-credentials-repo';
import { type AlgoSignals, computeAlgoSignals } from './algo/algo-signals';
import { buildCandidatePool, type CandidateEntry } from './build-candidate-pool';
import type { LlmClient } from './llm-client';
import type { NewsItem } from './news-fetcher';
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
  /** 사용자가 stock-picker 등으로 추가한 pdno 목록 — 보유/감시에 없어도 풀에 합쳐 추천. */
  extraPdnos?: ReadonlyArray<string>;
  /**
   * 후보 pdno 목록의 일봉 캐시를 사전 보충. 호출자(ai-router)가 KIS env/auth 컨텍스트를
   * 들고 ensure 콜백을 주입. 미주입 시 캐시만 사용 (기존 동작).
   */
  ensureCandles?: (pdnos: ReadonlyArray<string>) => Promise<void>;
  /**
   * 종목별 최신 뉴스 fetch 콜백 — 라우터가 NewsFetcher 컨텍스트로 wrap. 미주입 시 뉴스 무.
   * 여러 종목을 받아 pdno→newsItems Map 으로 반환. AI on 일 때만 호출 권장.
   */
  fetchNews?: (
    candidates: ReadonlyArray<{ pdno: string; name: string }>,
  ) => Promise<Map<string, ReadonlyArray<NewsItem>>>;
  /**
   * AI 끄기 모드 — true 면 LLM 호출 0회, 알고리즘 신호만으로 ranking. 결과 카드의
   * pros/cons/entryNote 는 알고리즘 라벨에서 합성.
   */
  aiOff?: boolean;
}

const RankedItemSchema = z.object({
  pdno: z.string(),
  score: z.number().min(0).max(100),
  volatilityFit: z.enum(['low', 'mid', 'high']),
  liquidityFit: z.enum(['good', 'ok', 'poor']),
  /** 한 줄 평 — 카드 기본 노출. */
  summary: z.string().min(1).max(120),
  /** 매직스플릿 적용 시 강점. 0~3개. */
  pros: z.array(z.string().max(80)).max(3).default([]),
  /** 주의점/리스크. 0~3개. */
  cons: z.array(z.string().max(80)).max(3).default([]),
  /** 진입 시 참고할 한 줄 (예: "박스권 하단 근처 1차 매수 추천"). 없으면 null. */
  entryNote: z.string().max(160).nullable().default(null),
});

const SuggestionResponseSchema = z.object({
  ranked: z.array(RankedItemSchema),
});

export interface RankedSymbolStats {
  lastClose: number | null;
  volatility60d: number | null;
  avgVolume60d: number | null;
  rangePct120d: number | null;
}

export type RankedSymbol = z.infer<typeof RankedItemSchema> & {
  /** 응답에 lookup 한 종목명. */
  name: string;
  /** 후보 출처 (보유/감시/수동). */
  sources: ReadonlyArray<'OWNED' | 'WATCH' | 'MANUAL'>;
  /** 통계 수치 — UI 에서 LLM 점수 근거를 직접 노출. */
  stats: RankedSymbolStats;
  /** 결정론적 알고리즘 점수 (0~100). LLM 점수와 비교해 일관성 검증 가능. */
  algoScore: number | null;
  /** 알고리즘 라벨 (변동성/박스권/RSI/거래량 spike 등). */
  algoLabels: ReadonlyArray<string>;
  /** AI 끄기 모드로 생성된 결과인지. */
  aiOff: boolean;
  /** LLM 이 참조한(또는 AI off 시 미사용) 뉴스 원본. UI 카드 펼침 시 노출. */
  news: ReadonlyArray<NewsItem>;
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
  const aiOff = input.aiOff === true;
  const config = aiOff ? null : input.aiCredentialsRepo.getDefaultWithKey();
  if (!aiOff && !config) {
    return {
      ranked: [],
      emptyReason:
        'AI 키가 등록되지 않았습니다. 설정 → AI 탭에서 키를 등록하거나 "AI 끄기" 모드를 선택하세요.',
      rejectedCount: 0,
      durationMs: 0,
    };
  }

  const pool = buildCandidatePool({
    db: input.db,
    accountId: input.accountId,
    cap: input.poolCap ?? 30,
    ...(input.extraPdnos && input.extraPdnos.length > 0 ? { extraPdnos: input.extraPdnos } : {}),
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

  if (input.ensureCandles) {
    await input.ensureCandles(pool.map((p) => p.pdno));
  }

  // 결정론적 알고리즘 신호 — AI on/off 모두 활용.
  const algoSignals = computeAlgoSignals({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
  });
  const algoByPdno = new Map(algoSignals.map((s) => [s.pdno, s]));

  const stats = computeSymbolStats({
    candlesRepo: input.candlesRepo,
    pdnos: pool.map((p) => p.pdno),
  });
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));

  // AI 끄기 — LLM 호출 없이 algoScore 로 ranking + labels 합성.
  if (aiOff) {
    const ranked = buildAlgoOnlyRanked(pool, algoByPdno, statsByPdno).slice(0, input.topN ?? 5);
    input.logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'ai.suggest-symbols.algo-only',
      payload: { poolSize: pool.length, topN: ranked.length, durationMs: Date.now() - startedAt },
    });
    return {
      ranked,
      emptyReason: ranked.length === 0 ? '추천 가능한 종목이 없습니다.' : null,
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // AI on — 알고리즘 상위 N 만 뉴스 fetch (토큰/호출 절감).
  const algoRanked = [...pool].sort((a, b) => {
    const sa = algoByPdno.get(a.pdno)?.splitScore ?? -1;
    const sb = algoByPdno.get(b.pdno)?.splitScore ?? -1;
    return sb - sa;
  });
  const newsTargetN = Math.min(10, algoRanked.length);
  const newsTargets = algoRanked.slice(0, newsTargetN);
  const newsByPdno = input.fetchNews ? await input.fetchNews(newsTargets) : new Map();

  const userPrompt = buildPrompt({
    pool,
    stats,
    algoByPdno,
    newsByPdno,
    topN: input.topN ?? 5,
  });

  // config 는 aiOff=false 분기에서만 도달 — 위에서 null 체크 완료.
  if (!config) {
    return {
      ranked: [],
      emptyReason: 'AI 키가 등록되지 않았습니다.',
      rejectedCount: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const result = await input.llmClient.chat({
    config,
    schema: SuggestionResponseSchema,
    schemaName: 'AiSymbolSuggestion',
    maxOutputTokens: 1500,
    messages: [
      {
        role: 'system',
        content: [
          '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 보조 분석가입니다.',
          '',
          '핵심 원칙 (가장 중요):',
          '1. 후보 풀에 명시된 pdno 코드 안에서만 추천. 풀 외 종목은 절대 포함 X.',
          '2. 정보 신뢰성 우선. 추측/일반론 X. 가능하면 입력으로 받은 알고리즘 신호(algoScore/RSI/거래량 spike) + 뉴스 제목/요약/날짜를 직접 인용해 근거를 만든다.',
          '3. 뉴스 분석 가이드:',
          '   - 발행 일자(publishedAt)를 반드시 확인 — 최근일수록 가중치 높게.',
          '   - 사실(공시·실적·자사주매입) > 의견(애널리스트 전망) > 기사 헤드라인 추측 순으로 신뢰.',
          '   - 같은 종목 뉴스 여러 건 사이에 모순(긍정 vs 부정)이 보이면 cons 에 명시.',
          '   - 어닝 발표 D-3 이내, 자사주매입 결정, 전환사채/유상증자, 임원 매도 같은 거래 영향 큰 이벤트는 entryNote 에 명시.',
          '   - 헤드라인만 보고 단정 X. 요약 본문도 함께 검토.',
          '4. 알고리즘 신호와 뉴스가 충돌하면 cons 에 충돌 사실을 적고 score 를 보수적으로 낮춘다.',
          '5. summary 는 사실 기반의 한 줄. pros/cons 는 행동 가이드. entryNote 는 진입 시점/주의사항 1줄.',
          '6. 데이터 부족(통계 부족 / 뉴스 0건)인 종목은 score 를 보수적으로 낮추고 cons 에 "데이터 부족" 명시.',
        ].join('\n'),
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
  const poolByPdno = new Map(pool.map((p) => [p.pdno, p]));
  let rejectedCount = 0;
  const ranked: RankedSymbol[] = [];
  for (const item of result.parsed.ranked) {
    if (!allowedPdnos.has(item.pdno)) {
      rejectedCount++;
      continue;
    }
    const poolEntry = poolByPdno.get(item.pdno);
    const stat = statsByPdno.get(item.pdno);
    const algo = algoByPdno.get(item.pdno);
    ranked.push({
      ...item,
      name: poolEntry?.name ?? item.pdno,
      sources: poolEntry?.sources ?? [],
      stats: {
        lastClose: stat?.lastClose ?? null,
        volatility60d: stat?.volatility60d ?? null,
        avgVolume60d: stat?.avgVolume60d ?? null,
        rangePct120d: stat?.rangePct120d ?? null,
      },
      algoScore: algo?.splitScore ?? null,
      algoLabels: algo?.labels ?? [],
      aiOff: false,
      news: newsByPdno.get(item.pdno) ?? [],
    });
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

  return {
    ranked: topped,
    emptyReason: topped.length === 0 ? '추천할 만한 종목이 없습니다.' : null,
    rejectedCount,
    durationMs: Date.now() - startedAt,
  };
}

function buildPrompt(args: {
  pool: ReadonlyArray<CandidateEntry>;
  stats: ReadonlyArray<SymbolStat>;
  algoByPdno: Map<string, AlgoSignals>;
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>;
  topN: number;
}): string {
  const { pool, stats, algoByPdno, newsByPdno, topN } = args;
  const statsByPdno = new Map(stats.map((s) => [s.pdno, s]));
  const lines: string[] = [];
  lines.push(`아래 ${pool.length}개 후보 종목 중 매직스플릿(분할매수/분할매도) 전략에 적합한`);
  lines.push(`상위 ${topN}개를 골라 점수와 한 줄 평을 제시해 주세요.`);
  lines.push('');
  lines.push('매직스플릿 적합도 판단 기준:');
  lines.push('- 변동성이 너무 낮으면 차수 진입 트리거 부족 (low fit), 너무 높으면 손실 위험');
  lines.push('- 거래량이 충분해야 슬리피지 방지');
  lines.push('- 박스권 폭이 적당하면 차수 간격 설계가 쉬움');
  lines.push(
    '- 알고리즘 splitScore 는 결정론적 사전 점수 — 참고하되 맹신 X. 최신 뉴스/이벤트가 있으면 우선 반영',
  );
  lines.push('');
  lines.push('응답 JSON schema:');
  lines.push(
    '{"ranked":[{"pdno":"<후보 풀의 pdno>","score":0~100,"volatilityFit":"low|mid|high","liquidityFit":"good|ok|poor","summary":"한 줄 평(120자 이내)","pros":["매직스플릿 적용 시 강점",...max 3],"cons":["주의점/리스크",...max 3],"entryNote":"진입 시 참고할 한 줄(160자 이내) 또는 null"}]}',
  );
  lines.push('각 pros/cons 는 80자 이내 짧은 문장. 진단형이 아닌 행동 가이드로 작성.');
  lines.push('');
  lines.push('후보 풀:');
  for (const c of pool) {
    const s = statsByPdno.get(c.pdno);
    const algo = algoByPdno.get(c.pdno);
    const sourcesLabel = c.sources.join('+');
    const algoBits =
      algo && algo.splitScore !== null
        ? ` algoScore=${algo.splitScore}, RSI=${algo.rsi14 ?? 'n/a'}, momentum20d=${algo.momentum20d ?? 'n/a'}%, volSpike=${algo.volumeSpikeRatio ?? 'n/a'}x${algo.labels.length > 0 ? `, labels=[${algo.labels.join(', ')}]` : ''}`
        : '';
    if (!s || s.dataReason) {
      lines.push(
        `- ${c.pdno} (${c.name}) [${sourcesLabel}] — 통계 부족(${s?.dataReason ?? 'no-data'})${algoBits}`,
      );
    } else {
      lines.push(
        `- ${c.pdno} (${c.name}) [${sourcesLabel}] — close=${s.lastClose}, vol60d=${s.volatility60d ?? 'n/a'}%, avgVol60d=${s.avgVolume60d ?? 'n/a'}, range120d=${s.rangePct120d ?? 'n/a'}%${algoBits}`,
      );
    }
    const news = newsByPdno.get(c.pdno);
    if (news && news.length > 0) {
      lines.push(`    뉴스 ${news.length}건 (최신순):`);
      news.forEach((n, idx) => {
        const summary = n.summary.length > 220 ? `${n.summary.slice(0, 220)}...` : n.summary;
        lines.push(`    [${idx + 1}] ${n.publishedAt} | ${n.title}`);
        if (summary) lines.push(`        ${summary}`);
      });
    } else {
      lines.push('    (뉴스 없음 — 데이터 부족으로 보수적 평가 권장)');
    }
  }
  lines.push('');
  lines.push('주의:');
  lines.push('- 후보 풀에 없는 pdno 는 응답에 포함하지 마세요.');
  lines.push(
    '- 뉴스 내용을 인용할 때 발행일과 헤드라인 핵심을 entryNote/cons/pros 에 직접 녹여 작성.',
  );
  lines.push(
    '- 알고리즘 점수(algoScore) 와 LLM 점수(score) 차이가 크면 그 이유를 cons 에 짧게 적기.',
  );
  return lines.join('\n');
}

/**
 * AI 끄기 모드 — algoScore 내림차순으로 ranking 후 RankedSymbol 형태로 합성.
 * pros/cons/entryNote 는 알고리즘 라벨로부터 정성적 문구 생성 (LLM 없음).
 */
function buildAlgoOnlyRanked(
  pool: ReadonlyArray<CandidateEntry>,
  algoByPdno: Map<string, AlgoSignals>,
  statsByPdno: Map<string, SymbolStat>,
): RankedSymbol[] {
  const ranked = [...pool]
    .map((c) => {
      const algo = algoByPdno.get(c.pdno);
      const stat = statsByPdno.get(c.pdno);
      const score = algo?.splitScore ?? 0;
      const volComp = algo?.components.volatility ?? null;
      const liqComp = algo?.components.liquidity ?? null;
      const volatilityFit: 'low' | 'mid' | 'high' =
        volComp === null ? 'mid' : volComp >= 75 ? 'mid' : volComp >= 40 ? 'low' : 'high';
      const liquidityFit: 'good' | 'ok' | 'poor' =
        liqComp === null ? 'ok' : liqComp >= 75 ? 'good' : liqComp >= 50 ? 'ok' : 'poor';
      const labels = algo?.labels ?? [];
      const pros: string[] = [];
      const cons: string[] = [];
      if ((algo?.components.volatility ?? 0) >= 75) pros.push('변동성 적정 — 차수 트리거 충분');
      if ((algo?.components.liquidity ?? 0) >= 75) pros.push('거래량 충분 — 슬리피지 위험 낮음');
      if ((algo?.components.range ?? 0) >= 75) pros.push('박스권 폭 적정 — 차수 간격 설계 용이');
      if (algo?.rsi14 !== null && algo !== undefined) {
        if (algo.rsi14 !== null) {
          if (algo.rsi14 >= 70) cons.push(`RSI ${algo.rsi14} 과매수 — 진입 시점 지연 권장`);
          else if (algo.rsi14 <= 30) pros.push(`RSI ${algo.rsi14} 과매도 — 1차 진입 매력`);
        }
      }
      if (algo?.volumeSpikeRatio && algo.volumeSpikeRatio >= 1.5) {
        cons.push(`거래량 ${algo.volumeSpikeRatio}x spike — 이벤트 임박 가능성`);
      }
      if ((algo?.components.volatility ?? 100) < 40) cons.push('변동성 낮음 — 차수 트리거 부족');
      const entryNote =
        algo?.box && algo.rsi14 !== null
          ? `박스권 ${algo.box.low.toLocaleString()}~${algo.box.high.toLocaleString()} 중 RSI ${algo.rsi14}. 박스 하단 근처 1차 매수 검토.`
          : null;
      return {
        pdno: c.pdno,
        name: c.name,
        score,
        volatilityFit,
        liquidityFit,
        summary:
          labels.length > 0
            ? labels.join(' / ')
            : algo?.splitScore !== null
              ? `알고리즘 점수 ${algo?.splitScore ?? 0}점`
              : '데이터 부족',
        pros: pros.slice(0, 3),
        cons: cons.slice(0, 3),
        entryNote,
        sources: c.sources,
        stats: {
          lastClose: stat?.lastClose ?? null,
          volatility60d: stat?.volatility60d ?? null,
          avgVolume60d: stat?.avgVolume60d ?? null,
          rangePct120d: stat?.rangePct120d ?? null,
        },
        algoScore: algo?.splitScore ?? null,
        algoLabels: labels,
        aiOff: true,
        news: [],
      } satisfies RankedSymbol;
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked;
}

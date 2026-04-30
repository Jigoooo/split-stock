import type { AlgoSignals } from '../algo/algo-signals';
import type { CandidateEntry } from '../build-candidate-pool';
import type { MarketContextSnapshot } from '../market-context-service';
import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import { formatNewsEvidenceForPrompt, type NewsEvidencePack } from '../news-evidence';
import type { NewsItem } from '../news-fetcher';
import type { SymbolStat } from '../symbol-stats';
import { formatSearchTrendForPrompt } from './evidence';
import { formatMarketContextForPrompt } from './market-context';

export const SYSTEM_PROMPT = [
  '당신은 한국 주식 박스권 분할매매 전략 보조 분석가입니다.',
  '목표는 단순 상승 종목 예측이 아니라, 횡보·파동 구간에서 단계별 매수와 차수별 독립 익절을 반복할 수 있는 회전성 높은 후보를 고르는 것입니다.',
  '',
  '핵심 원칙 (가장 중요):',
  '1. 후보 풀에 명시된 pdno 코드 안에서만 추천. 풀 외 종목은 절대 포함 X.',
  '2. 정보 신뢰성 우선. 추측/일반론 X. 알고리즘 신호(rangeCycleScore, volatility/range/liquidity/trendNeutrality/supportProx, RSI, BB, MFI, Aroon, conflicts, indicatorReasons)를 직접 인용해 근거 작성.',
  '3. 추천의 1차 기준은 반복 회전성입니다. 박스권 폭, 적정 변동성, 충분한 거래량, 지지선 근접성, 강한 추세 회피를 뉴스보다 우선합니다.',
  '4. 뉴스/공시는 주 추천 이유가 아니라 이벤트성 급등락, 거래정지/관리종목성, 실적·공시 리스크를 보강하는 보조 근거입니다.',
  '5. consensus 규칙: BB/RSI/MFI/momentum/Stochastic/CCI 중 3개 이상이 동일 방향(과매수 또는 과매도)일 때만 strong 신호로 판단. 1~2개 동의 = weak. consensusCount 필드에 동의 개수 명시.',
  '6. conflicts 가 비어있지 않으면 cons 에 반드시 인용. 무시 X.',
  '7. 데이터 부족(통계 부족 / 뉴스 0건)이면 confidence=low 로 표기 + cons 에 "데이터 부족" 명시.',
  '8. 도구 사용 우선: 알고리즘 신호가 모호하거나 confidence=low 면 search_news / get_dart_disclosures / get_market_context 를 호출해 보강. 호출한 도구는 citedTools 에 기록. 빈 배열이면 "추가 검증 미수행" 으로 간주.',
  '9. tier 매핑: score ≥85 top, 70-84 strong, 55-69 moderate, 40-54 watch, <40 avoid. 종목별로 tier 를 명시.',
  '10. 응답 분배:',
  '   - recommended: top/strong/moderate/watch/avoid 골고루 — 사용자에게 다양한 정보 제공.',
  '   - userInputResults: 사용자가 입력한 종목(extras) 의 평가. recommended 와 별도. tier 분배 X.',
  '11. summary 는 사실 기반 한 줄. pros/cons 는 행동 가이드. entryNote 는 진입 시점/주의사항 1줄.',
  '12. 알고리즘 점수(algoScore) 와 LLM 점수(score) 차이가 30점 이상이면 그 이유를 cons 에 짧게 적기.',
  '13. KRX/ECOS/Naver DataLab 컨텍스트는 캐시된 외부 사실입니다. modifier/risk flag/근거 사실로만 사용하고 consensusCount 계산에는 포함하지 마세요.',
  '14. Naver DataLab ratio 는 요청 묶음 안 상대값입니다. 종목 간 절대 관심도 비교가 아니라 같은 종목의 최근 변화 방향만 참고하세요.',
  '',
  '박스권 분할매매 구조 (중요):',
  '- 각 차수는 평균단가 회복을 기다리는 묶음이 아니라 독립 익절 대상이다.',
  '- 2차 이후 매수 트리거는 1차 가격 기준이 아니라 직전 차수 매수가 기준이다.',
  '  예) 1차 10,000원 매수 → 2차 트리거: 1차가 × (1-3%) = 9,700원 / 3차 트리거: 2차가 × (1-3%) = 9,409원.',
  '  "1차 기준으로 -9% 하락 시 3차"가 아니라 "직전 차수에서 매번 -3% 추가 하락" 구조.',
  '- entryNote 에서 차수 트리거를 언급할 때는 반드시 직전 차수 기준 하락률로 표현할 것.',
  '- 강한 상승 추세 추격, 강한 하락 추세 물타기, 유동성 부족 종목은 회전성 후보에서 낮게 평가한다.',
].join('\n');

export function buildPrompt(args: {
  topCandidates: ReadonlyArray<CandidateEntry>;
  extras: ReadonlyArray<CandidateEntry>;
  stats: ReadonlyArray<SymbolStat>;
  algoByPdno: Map<string, AlgoSignals>;
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>;
  newsEvidenceByPdno: Map<string, NewsEvidencePack>;
  searchTrendsByPdno: Map<string, NaverSearchTrendSummary>;
  marketContext: MarketContextSnapshot | null;
  topN: number;
}): string {
  const { topCandidates, extras, topN } = args;
  const lines: string[] = [];
  lines.push(
    `[recommended 풀 — ${topCandidates.length}개 사전 선별] 박스권 분할매매 반복 회전성 상위 ${topN}개를`,
  );
  lines.push('top/strong/moderate/watch/avoid tier 로 골고루 분류해 주세요.');
  lines.push('');
  if (extras.length > 0) {
    lines.push(
      `[user input — ${extras.length}개] 사용자가 직접 추가한 종목. recommended 와 별도로 평가.`,
    );
    lines.push('');
  }
  lines.push('박스권 분할매매 판단 기준:');
  lines.push('- 반복 회전성 우선: 박스권 폭, 적정 변동성, 충분한 거래량이 함께 좋아야 함');
  lines.push('- 지지선/BB 하단/과매도 consensus 는 1차 진입 타이밍 근거로만 사용');
  lines.push('- 강한 상승 추세는 추격 위험, 강한 하락 추세는 단계 매수 위험으로 낮게 평가');
  lines.push('- 뉴스/공시는 호재 찾기보다 급등락·거래정지·실적/공시 리스크 확인에 사용');
  lines.push('');
  lines.push('응답 JSON schema:');
  lines.push(
    '{"recommended":[{"pdno":"<풀의 pdno>","score":0~100,"tier":"top|strong|moderate|watch|avoid","confidence":"high|med|low","volatilityFit":"low|mid|high","liquidityFit":"good|ok|poor","summary":"한 줄(200자)","pros":[max 3, 각 200자],"cons":[max 3, 각 200자],"entryNote":"한 줄(300자) or null","consensusCount":0~10,"citedTools":["search_news","get_dart_disclosures",...]}],"userInputResults":[...동일 schema...]}',
  );
  appendCandidateSection('recommended 풀', topCandidates, args, lines);
  if (extras.length > 0) {
    lines.push('');
    appendCandidateSection('user input', extras, args, lines);
  }
  lines.push('');
  lines.push('주의:');
  lines.push('- 후보 풀에 없는 pdno 는 응답에 포함하지 마세요.');
  lines.push('- conflicts 가 있으면 반드시 cons 에 그대로 인용.');
  lines.push('- consensusCount 는 BB/RSI/MFI/momentum/Stoch/CCI 중 동의한 개수.');
  lines.push('- citedTools 는 호출한 도구 이름. 호출 안 했으면 빈 배열.');
  lines.push('- KRX/ECOS/Naver DataLab 값은 캐시 보조 사실이며 consensusCount 에 포함하지 마세요.');
  lines.push(
    '- Naver DataLab ratio 는 종목 간 절대 비교가 아니라 같은 종목의 최근 변화 방향만 참고하세요.',
  );
  lines.push(
    '- 뉴스 evidence 는 중복 제거된 cluster 중심 보조 근거입니다. raw 기사 수가 많아도 cluster 근거 중심으로 판단하세요.',
  );
  return lines.join('\n');
}

function appendCandidateSection(
  title: string,
  candidates: ReadonlyArray<CandidateEntry>,
  args: Parameters<typeof buildPrompt>[0],
  lines: string[],
): void {
  lines.push(`=== ${title} ===`);
  const statsByPdno = new Map(args.stats.map((s) => [s.pdno, s]));
  for (const candidate of candidates) {
    appendCandidateBlock(candidate, statsByPdno, args, lines);
  }
}

function appendCandidateBlock(
  c: CandidateEntry,
  statsByPdno: Map<string, SymbolStat>,
  args: Parameters<typeof buildPrompt>[0],
  lines: string[],
): void {
  const s = statsByPdno.get(c.pdno);
  const algo = args.algoByPdno.get(c.pdno);
  const sourcesLabel = c.sources.join('+');
  const algoBits = formatAlgoBits(algo);
  const conflictsBits =
    algo && algo.conflicts.length > 0 ? `\n    conflicts: ${algo.conflicts.join(' | ')}` : '';
  if (!s || s.dataReason) {
    lines.push(
      `- ${c.pdno} (${c.name}) [${sourcesLabel}] — 통계 부족(${s?.dataReason ?? 'no-data'}) ${algoBits}${conflictsBits}`,
    );
  } else {
    lines.push(
      `- ${c.pdno} (${c.name}) [${sourcesLabel}] — close=${s.lastClose}, vol60d=${s.volatility60d ?? 'n/a'}%, range120d=${s.rangePct120d ?? 'n/a'}% | ${algoBits}${conflictsBits}`,
    );
  }
  if (algo && algo.indicatorReasons.length > 0) {
    lines.push(
      `    reasons: ${algo.indicatorReasons.map((r) => `[${r.indicator}] ${r.value}`).join(' / ')}`,
    );
  }
  const marketBits = formatMarketContextForPrompt(c.pdno, args.marketContext);
  if (marketBits) lines.push(`    시장 컨텍스트(캐시): ${marketBits}`);
  const searchTrend = args.searchTrendsByPdno.get(c.pdno);
  if (searchTrend)
    lines.push(`    Naver DataLab 검색 트렌드: ${formatSearchTrendForPrompt(searchTrend)}`);
  appendNewsLines(c.pdno, args.newsByPdno, args.newsEvidenceByPdno, lines);
}

function formatAlgoBits(algo: AlgoSignals | undefined): string {
  return algo && algo.rangeCycleScore !== null
    ? [
        `algoScore=${algo.rangeCycleScore}`,
        `confidence=${algo.confidence}`,
        `rangeCycle=${[
          `vol=${algo.components.volatility ?? 'n/a'}`,
          `range=${algo.components.range ?? 'n/a'}`,
          `liq=${algo.components.liquidity ?? 'n/a'}`,
          `support=${algo.components.supportProx ?? 'n/a'}`,
          `trend=${algo.components.trendNeutrality ?? 'n/a'}`,
        ].join('/')}`,
        algo.rsi14 !== null ? `RSI=${algo.rsi14}` : null,
        algo.bollinger?.position !== undefined && algo.bollinger?.position !== null
          ? `BB.pos=${(algo.bollinger.position * 100).toFixed(0)}%`
          : null,
        algo.mfi14 !== null ? `MFI=${algo.mfi14}` : null,
        algo.aroon25
          ? `Aroon=${Math.round(algo.aroon25.up)}/${Math.round(algo.aroon25.down)}`
          : null,
        algo.atr14 !== null ? `ATR=${algo.atr14}` : null,
        algo.consensusLevel !== 'none'
          ? `consensus=${algo.consensusLevel}/${algo.consensusDirection}(${algo.consensusCount})`
          : null,
        algo.divergence !== 'none' ? `OBV.div=${algo.divergence}` : null,
      ]
        .filter((x): x is string => x !== null)
        .join(', ')
    : '';
}

function appendNewsLines(
  pdno: string,
  newsByPdno: Map<string, ReadonlyArray<NewsItem>>,
  newsEvidenceByPdno: Map<string, NewsEvidencePack>,
  lines: string[],
): void {
  const evidence = newsEvidenceByPdno.get(pdno);
  if (evidence) {
    lines.push(`    ${formatNewsEvidenceForPrompt(evidence, 1800)}`);
    return;
  }
  const news = newsByPdno.get(pdno);
  if (!news || news.length === 0) return;
  lines.push(`    뉴스 ${news.length}건:`);
  news.forEach((n, idx) => {
    const summary = n.summary.length > 200 ? `${n.summary.slice(0, 200)}...` : n.summary;
    lines.push(`    [${idx + 1}] ${n.publishedAt} | ${n.title}`);
    if (summary) lines.push(`        ${summary}`);
  });
}

import type { EvidenceRef, MagicSplitFacts } from '../magic-split-facts';
import { formatNewsEvidenceForPrompt } from '../news-evidence';
import type { RankedMarketContext } from '../suggest-symbols';
import { formatSearchTrend } from './evidence';
import type { SuggestStrategyInput } from './types';

export const STRATEGY_SYSTEM_PROMPT = [
  '당신은 한국 주식 매직스플릿(분할매수/분할매도) 전략 설계 보조입니다.',
  '응답은 단일 JSON 객체로만 답하고, 차수 nth 는 1부터 maxStages 까지 순서대로 채우세요.',
  '핵심: triggerDropPct 는 "직전 차수 매수가 × (1 - triggerDropPct)" 로 다음 차수 트리거를 산출한다. 1차 가격 누적이 아니다.',
  '따라서 모든 차수에서 비교적 균일한 값(0.02~0.04)이 자연스러우며, 차수가 늘어난다고 해서 triggerDropPct 를 +0.02 씩 단조 증가시키면 안 된다.',
  'Naver DataLab 검색 트렌드는 종목 관심도/이벤트성 수요를 보는 보조 사실이며, 가격 지표를 대체하지 않는다.',
  'Naver DataLab ratio 는 요청 묶음 안 상대값이므로 절대 검색량이 아니라 최근 변화 방향만 참고한다.',
].join('\n');

export function buildStrategyPrompt(args: {
  input: Pick<
    SuggestStrategyInput,
    'pdno' | 'newsEvidence' | 'searchTrend' | 'marketContext' | 'desiredStages'
  >;
  stockName: string;
  facts: MagicSplitFacts;
  maxAllowedStages: number;
  evidenceRefs: ReadonlyArray<EvidenceRef>;
  disclosuresLine: string;
}): string {
  const { input, stockName, facts, maxAllowedStages, evidenceRefs, disclosuresLine } = args;
  const stat = facts.stat;
  return [
    `종목: ${stockName} (${input.pdno})`,
    `데이터 품질: ${facts.dataQuality} (${facts.dataQualityReason}), analysisConfidence=${facts.analysisConfidence}`,
    `최근 종가: ${stat.lastClose ?? 'n/a'} 원`,
    `60일 연환산 변동성: ${stat.volatility60d ?? 'n/a'}%`,
    `60일 평균 거래량: ${stat.avgVolume60d ?? 'n/a'} 주`,
    `120일 박스권 폭: ${stat.rangePct120d ?? 'n/a'}%`,
    `알고리즘 신호: score=${facts.algo.splitScore ?? 'n/a'}, consensus=${facts.algo.consensusLevel}/${facts.algo.consensusDirection}(${facts.algo.consensusCount}), confidence=${facts.algo.confidence}`,
    facts.algo.conflicts.length > 0 ? `충돌 신호: ${facts.algo.conflicts.join(' / ')}` : '',
    facts.algo.indicatorReasons.length > 0
      ? `지표 근거: ${facts.algo.indicatorReasons
          .map((r) => `[${r.indicator}] ${r.value} - ${r.meaning}`)
          .join(' / ')}`
      : '',
    formatMarketContext(input.marketContext),
    input.searchTrend ? `Naver DataLab 검색 트렌드: ${formatSearchTrend(input.searchTrend)}` : '',
    formatNewsEvidenceForPrompt(input.newsEvidence, 2400),
    disclosuresLine,
    '',
    `위 통계를 기반으로 매직스플릿 ${maxAllowedStages}차 전략을 설계해 주세요.`,
    '',
    '제약:',
    `- maxStages: 2~${maxAllowedStages} 범위. dataQuality=limited 이면 반드시 3 이하.`,
    '- buyRules[0].triggerDropPct 는 반드시 null (1차는 수동 진입)',
    '- buyRules[1..].triggerDropPct: **직전 차수 매수가 대비** 하락률 (0.02 = 2%, 0.03 = 3% 등).',
    '  ⚠ 1차 가격 누적 기준이 아니라 매번 직전 차수 가격에서 추가로 N% 하락. 복리로 누적됨.',
    '  예) 1차 10,000원 매수 + triggerDropPct 0.03(3%) → 2차 트리거: 10,000×0.97=9,700원. 3차 트리거: 9,700×0.97=9,409원 (1차 대비 -5.91%).',
    '  따라서 차수가 깊어질수록 triggerDropPct 자체를 키울 필요는 거의 없다. 일반적으로 0.02~0.04 정도로 비교적 균일하게 분포.',
    '  ❌ 잘못된 패턴 예: 2차 0.05, 3차 0.07, 4차 0.09, 5차 0.11 — 이는 "1차 대비 누적 -5/-7/-9/-11%"를 직전 대비로 오인한 결과. 직전 대비로 +2%씩 단조 증가시키지 말 것.',
    '  ✅ 권장 패턴 예: 박스권 폭 30% / 변동성 35% 종목이라면 직전 대비 0.03~0.04 정도 균일하게.',
    '- amountKrw: 모든 차수 동일 또는 점증 (예: 차수 늘수록 더 큰 금액으로 평단가 빠르게 낮춤)',
    '- sellRules[i].targetProfitPct: 차수별 익절률. 보통 후순위 차수가 더 작은 익절(빠른 회수)',
    '- dataQuality=limited 에서는 triggerDropPct 0.02~0.035, targetProfitPct 0.015~0.04, amountKrw 는 1차 대비 최대 1.5배까지만 허용.',
    '- reasoning: 추천 근거 1~2 문장 (한국어, 400자 이내)',
    '- stageRationales: 차수별 rationale 과 evidenceRefs(id 문자열)를 채움.',
    '- globalRisks: 데이터 부족/뉴스 충돌/지표 충돌 등 전역 리스크.',
    '- evidenceRefs: 아래 evidence 후보 중 사용한 id/title/detail 을 보존.',
    `evidence candidates: ${JSON.stringify(evidenceRefs).slice(0, 2500)}`,
    '',
    '응답 JSON schema:',
    '{"maxStages":int,"buyRules":[{"nth":int,"triggerDropPct":number|null,"amountKrw":int}],"sellRules":[{"nth":int,"targetProfitPct":number}],"reasoning":"...","stageRationales":[{"nth":int,"rationale":"...","evidenceRefs":["..."]}],"globalRisks":["..."],"evidenceRefs":[{"id":"...","kind":"indicator|news|disclosure|market|dataQuality","title":"...","detail":"..."}],"analysisConfidence":"high|med|low","dataQuality":"blocked|limited|normal"}',
  ].join('\n');
}

function formatMarketContext(context: RankedMarketContext | null | undefined): string {
  return context ? `시장 컨텍스트: ${JSON.stringify(context).slice(0, 1200)}` : '';
}

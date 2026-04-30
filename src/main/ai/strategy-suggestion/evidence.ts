import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import type { EvidenceRef, RangeCycleFacts } from '../range-cycle-facts';
import type { SuggestStrategyInput } from './types';

export async function fetchDisclosureContext(
  input: SuggestStrategyInput,
): Promise<{ disclosuresLine: string; disclosureRefs: EvidenceRef[] }> {
  if (!input.corpCode || !input.dartClient.isAvailable()) {
    return { disclosuresLine: '', disclosureRefs: [] };
  }
  try {
    const recent = await input.dartClient.listRecentDisclosures(input.corpCode, 30, 8);
    if (recent.length === 0) return { disclosuresLine: '', disclosureRefs: [] };
    const disclosureRefs = recent.map((disclosure, index) => ({
      id: `disclosure:${disclosure.rceptNo || disclosure.rceptDt}:${index + 1}`,
      kind: 'disclosure' as const,
      title: disclosure.reportNm,
      detail: `${disclosure.rceptDt} 접수번호 ${disclosure.rceptNo}`,
    }));
    return {
      disclosureRefs,
      disclosuresLine: `\n최근 30일 공시(${recent.length}건):\n${disclosureRefs
        .map((ref) => `- [${ref.id}] ${ref.detail}: ${ref.title}`)
        .join('\n')}`,
    };
  } catch (cause) {
    input.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.suggest-strategy.disclosure-context-failed',
      payload: {
        pdno: input.pdno,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    });
    return { disclosuresLine: '', disclosureRefs: [] };
  }
}

export function buildStrategyEvidenceRefs(
  facts: RangeCycleFacts,
  disclosureRefs: ReadonlyArray<EvidenceRef>,
  input: Pick<SuggestStrategyInput, 'searchTrend' | 'newsEvidence'>,
): EvidenceRef[] {
  return [
    {
      id: `data:${facts.dataQuality}`,
      kind: 'dataQuality',
      title: facts.dataQuality === 'limited' ? '제한 분석' : '정상 분석',
      detail: facts.dataQualityReason,
    } satisfies EvidenceRef,
    ...facts.evidenceRefs,
    ...disclosureRefs,
    ...(input.searchTrend ? [searchTrendEvidenceRef(input.searchTrend)] : []),
    ...(input.newsEvidence?.clusters ?? []).map(
      (cluster): EvidenceRef => ({
        id: cluster.id,
        kind: 'news',
        title: cluster.title,
        detail: cluster.summary,
      }),
    ),
  ].slice(0, 16);
}

export function searchTrendEvidenceRef(trend: NaverSearchTrendSummary): EvidenceRef {
  return {
    id: 'market:naver-datalab',
    kind: 'market',
    title: `Naver DataLab ${trend.title}`,
    detail: formatSearchTrend(trend),
  };
}

export function formatSearchTrend(trend: NaverSearchTrendSummary): string {
  const parts = [
    `${trend.startDate}~${trend.endDate}`,
    trend.latestRatio !== null && trend.latestPeriod !== null
      ? `latest=${trend.latestRatio}@${trend.latestPeriod}`
      : null,
    trend.changeFromPrevious !== null ? `prevDiff=${trend.changeFromPrevious}` : null,
    trend.changeFromAverage !== null ? `avgDiff=${trend.changeFromAverage}` : null,
    trend.slope !== null ? `periodSlope=${trend.slope}` : null,
  ].filter((value): value is string => value !== null);
  return parts.join(', ');
}

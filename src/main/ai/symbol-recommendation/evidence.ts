import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import type { NewsEvidencePack } from '../news-evidence';
import type { EvidenceRef, RangeCycleFacts } from '../range-cycle-facts';

export function buildSymbolEvidenceRefs(
  facts: RangeCycleFacts | undefined,
  newsEvidence: NewsEvidencePack | undefined,
  citedTools: ReadonlyArray<string> = [],
  disclosureEvidenceRefs: ReadonlyArray<EvidenceRef> = [],
  searchTrend: NaverSearchTrendSummary | undefined = undefined,
): RangeCycleFacts['evidenceRefs'] {
  const refs: RangeCycleFacts['evidenceRefs'] = [];
  if (facts) {
    refs.push({
      id: `data:${facts.dataQuality}`,
      kind: 'dataQuality',
      title:
        facts.dataQuality === 'blocked'
          ? '데이터 부족'
          : facts.dataQuality === 'limited'
            ? '제한 분석'
            : '정상 분석',
      detail: facts.dataQualityReason,
    });
    refs.push(...facts.evidenceRefs);
  }
  for (const cluster of newsEvidence?.clusters ?? []) {
    refs.push({
      id: cluster.id,
      kind: 'news',
      title: cluster.title,
      detail: cluster.summary,
    });
  }
  if (searchTrend) {
    refs.push(searchTrendEvidenceRef(searchTrend));
  }
  if (citedTools.includes('get_dart_disclosures')) {
    refs.push(...disclosureEvidenceRefs);
  }
  return dedupeEvidenceRefs(refs).slice(0, 16);
}

export function searchTrendEvidenceRef(trend: NaverSearchTrendSummary): EvidenceRef {
  return {
    id: `market:naver-datalab:${trend.key}`,
    kind: 'market',
    title: `Naver DataLab ${trend.title}`,
    detail: formatSearchTrendForPrompt(trend),
  };
}

export function formatSearchTrendForPrompt(trend: NaverSearchTrendSummary): string {
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

export function extractDisclosureEvidenceRefs(
  toolCalls: ReadonlyArray<{ name: string; args: unknown; result: string }>,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const call of toolCalls) {
    if (call.name !== 'get_dart_disclosures') continue;
    const parsed = safeParseDisclosureToolResult(call.result);
    parsed.slice(0, 6).forEach((item, index) => {
      refs.push({
        id: `disclosure:${item.date}:${index + 1}`,
        kind: 'disclosure',
        title: item.title,
        detail: `${item.date} ${item.report}`,
      });
    });
  }
  return dedupeEvidenceRefs(refs).slice(0, 8);
}

function safeParseDisclosureToolResult(
  value: string,
): Array<{ date: string; title: string; report: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const date = typeof record.date === 'string' ? record.date : '';
        const title = typeof record.title === 'string' ? record.title : '';
        const report = typeof record.report === 'string' ? record.report : '';
        if (!date || !title) return null;
        return { date, title, report };
      })
      .filter((item): item is { date: string; title: string; report: string } => item !== null);
  } catch {
    return [];
  }
}

function dedupeEvidenceRefs(refs: ReadonlyArray<EvidenceRef>): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

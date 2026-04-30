import type { NaverSearchTrendSummary } from '../naver-datalab-client';
import {
  DEFAULT_MAX_SYMBOLS_PER_PASS,
  flattenRepresentativeNews,
  type NewsEvidencePack,
} from '../news-evidence';
import { dedupeCandidates } from './candidate-flow';
import { mergeDiagnostics, safeContextFetch } from './market-context';
import type { SuggestSymbolsDiagnostics, SuggestSymbolsInput } from './types';

export { DEFAULT_MAX_SYMBOLS_PER_PASS, dedupeCandidates };

export async function fetchExternalContext(
  input: SuggestSymbolsInput,
  newsTargets: ReadonlyArray<{ pdno: string; name: string }>,
  diagnostics: SuggestSymbolsDiagnostics,
) {
  const newsEvidenceByPdno = await fetchNewsEvidence(input, newsTargets, diagnostics);
  const newsByPdno =
    newsEvidenceByPdno.size > 0
      ? new Map(
          [...newsEvidenceByPdno.entries()].map(([pdno, pack]) => [
            pdno,
            flattenRepresentativeNews(pack),
          ]),
        )
      : await fetchNews(input, newsTargets, diagnostics);
  diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
    {
      source: 'naver-news',
      status: newsByPdno.size > 0 || newsEvidenceByPdno.size > 0 ? 'used' : 'skipped',
      count: newsByPdno.size || newsEvidenceByPdno.size,
      reason: newsByPdno.size > 0 || newsEvidenceByPdno.size > 0 ? null : 'no-news-context',
    },
  ]);

  const searchTrendsByPdno = await fetchSearchTrends(input, newsTargets, diagnostics);
  diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
    {
      source: 'naver-datalab',
      status: searchTrendsByPdno.size > 0 ? 'used' : 'skipped',
      count: searchTrendsByPdno.size,
      reason: searchTrendsByPdno.size > 0 ? null : 'no-search-trend-context',
    },
  ]);
  return { diagnostics, newsByPdno, newsEvidenceByPdno, searchTrendsByPdno };
}

async function fetchNewsEvidence(
  input: SuggestSymbolsInput,
  targets: ReadonlyArray<{ pdno: string; name: string }>,
  diagnostics: SuggestSymbolsDiagnostics,
) {
  return input.fetchNewsEvidence
    ? await safeContextFetch(
        () => input.fetchNewsEvidence?.(targets) ?? Promise.resolve(new Map()),
        input.logger,
        'naver-news',
        (reason) => {
          diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
            { source: 'naver-news', status: 'failed', reason },
          ]);
        },
      )
    : new Map<string, NewsEvidencePack>();
}

async function fetchNews(
  input: SuggestSymbolsInput,
  targets: ReadonlyArray<{ pdno: string; name: string }>,
  diagnostics: SuggestSymbolsDiagnostics,
) {
  return input.fetchNews
    ? await safeContextFetch(
        () => input.fetchNews?.(targets) ?? Promise.resolve(new Map()),
        input.logger,
        'naver-news',
        (reason) => {
          diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
            { source: 'naver-news', status: 'failed', reason },
          ]);
        },
      )
    : new Map();
}

async function fetchSearchTrends(
  input: SuggestSymbolsInput,
  targets: ReadonlyArray<{ pdno: string; name: string }>,
  diagnostics: SuggestSymbolsDiagnostics,
) {
  return input.fetchSearchTrends
    ? await safeContextFetch(
        () => input.fetchSearchTrends?.(targets) ?? Promise.resolve(new Map()),
        input.logger,
        'naver-datalab',
        (reason) => {
          diagnostics.sources = mergeDiagnostics(diagnostics.sources, [
            { source: 'naver-datalab', status: 'failed', reason },
          ]);
        },
      )
    : new Map<string, NaverSearchTrendSummary>();
}

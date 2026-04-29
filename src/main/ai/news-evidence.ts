import * as stringSimilarityModule from 'string-similarity-js';
import type { NewsItem, NewsSearchOptions } from './news-fetcher';

export interface NewsEvidenceArticle extends NewsItem {
  sourceQuery: string;
  sourceSort: 'date' | 'sim';
}

export interface NewsEvidenceCluster {
  id: string;
  title: string;
  summary: string;
  latestPublishedAt: string;
  representative: ReadonlyArray<NewsEvidenceArticle>;
  hiddenCount: number;
}

export interface NewsEvidencePack {
  pdno: string;
  name: string;
  queries: ReadonlyArray<string>;
  rawCount: number;
  uniqueCount: number;
  clusters: ReadonlyArray<NewsEvidenceCluster>;
}

export interface CollectNewsEvidenceInput {
  pdno: string;
  name: string;
  search: (options: NewsSearchOptions) => Promise<ReadonlyArray<NewsItem>>;
  display?: number;
  start?: number;
  maxQueries?: number;
  maxClusters?: number;
  maxRepresentativesPerCluster?: number;
}

const DEFAULT_DISPLAY = 30;
const DEFAULT_START = 1;
const DEFAULT_MAX_QUERIES = 6;
export const DEFAULT_MAX_SYMBOLS_PER_PASS = 6;
const DEFAULT_MAX_CLUSTERS = 8;
const DEFAULT_REPRESENTATIVES = 2;
const SIMILAR_TITLE_THRESHOLD = 0.72;
type StringSimilarityFn = (left: string, right: string) => number;
const stringSimilarityExports = stringSimilarityModule as {
  default?: unknown;
  stringSimilarity?: unknown;
};
const compareStrings = resolveStringSimilarity();

export function buildNewsQueries(name: string): string[] {
  const base = name.trim();
  if (!base) return [];
  return [base, `${base} 실적`, `${base} 공시`, `${base} 수주`, `${base} 투자`, `${base} 리스크`];
}

export async function collectNewsEvidence(
  input: CollectNewsEvidenceInput,
): Promise<NewsEvidencePack> {
  const queries = buildNewsQueries(input.name).slice(0, input.maxQueries ?? DEFAULT_MAX_QUERIES);
  const display = input.display ?? DEFAULT_DISPLAY;
  const start = input.start ?? DEFAULT_START;
  const articles: NewsEvidenceArticle[] = [];

  for (const query of queries) {
    for (const sort of ['date', 'sim'] as const) {
      const items = await input.search({ query, display, start, sort });
      articles.push(...items.map((item) => ({ ...item, sourceQuery: query, sourceSort: sort })));
    }
  }

  const unique = dedupeArticles(articles);
  const clusters = clusterArticles(unique, {
    maxClusters: input.maxClusters ?? DEFAULT_MAX_CLUSTERS,
    maxRepresentativesPerCluster: input.maxRepresentativesPerCluster ?? DEFAULT_REPRESENTATIVES,
  });

  return {
    pdno: input.pdno,
    name: input.name,
    queries,
    rawCount: articles.length,
    uniqueCount: unique.length,
    clusters,
  };
}

export function flattenRepresentativeNews(pack: NewsEvidencePack | undefined): NewsItem[] {
  if (!pack) return [];
  return pack.clusters.flatMap((cluster) =>
    cluster.representative.map(
      ({ sourceQuery: _sourceQuery, sourceSort: _sourceSort, ...item }) => item,
    ),
  );
}

export function formatNewsEvidenceForPrompt(
  pack: NewsEvidencePack | undefined,
  maxChars: number,
): string {
  if (!pack || pack.clusters.length === 0) return '뉴스 evidence: 없음';
  const lines: string[] = [
    `뉴스 evidence: query ${pack.queries.length}개, raw ${pack.rawCount}건, unique ${pack.uniqueCount}건, cluster ${pack.clusters.length}개`,
  ];
  for (const cluster of pack.clusters) {
    const reps = cluster.representative
      .map((article) => `${article.publishedAt} ${article.title}`)
      .join(' / ');
    lines.push(`- [${cluster.id}] ${cluster.title}: ${cluster.summary} (${reps})`);
  }
  return compact(lines.join('\n'), maxChars);
}

function dedupeArticles(articles: ReadonlyArray<NewsEvidenceArticle>): NewsEvidenceArticle[] {
  const out: NewsEvidenceArticle[] = [];
  const seenLinks = new Set<string>();
  for (const article of articles) {
    const linkKey = article.link.trim();
    if (linkKey && seenLinks.has(linkKey)) continue;
    const normalized = normalizeText(article.title);
    const duplicate = out.some((existing) => {
      const existingTitle = normalizeText(existing.title);
      return (
        normalized.length > 0 &&
        existingTitle.length > 0 &&
        compareStrings(normalized, existingTitle) >= SIMILAR_TITLE_THRESHOLD
      );
    });
    if (duplicate) continue;
    if (linkKey) seenLinks.add(linkKey);
    out.push(article);
  }
  return sortByDateDesc(out);
}

function clusterArticles(
  articles: ReadonlyArray<NewsEvidenceArticle>,
  options: { maxClusters: number; maxRepresentativesPerCluster: number },
): NewsEvidenceCluster[] {
  const buckets: NewsEvidenceArticle[][] = [];
  for (const article of articles) {
    const normalized = normalizeText(article.title);
    const bucket = buckets.find((candidate) => {
      const head = candidate[0];
      if (!head) return false;
      return compareStrings(normalized, normalizeText(head.title)) >= SIMILAR_TITLE_THRESHOLD;
    });
    if (bucket) bucket.push(article);
    else buckets.push([article]);
  }

  const clusters: NewsEvidenceCluster[] = [];
  for (const [index, bucket] of buckets.entries()) {
    if (clusters.length >= options.maxClusters) break;
    const sorted = sortByDateDesc(bucket);
    const head = sorted[0];
    if (!head) continue;
    const representative = sorted.slice(0, options.maxRepresentativesPerCluster);
    clusters.push({
      id: `news-${index + 1}`,
      title: compact(head.title, 120),
      summary: compact(head.summary || head.title, 220),
      latestPublishedAt: head.publishedAt,
      representative,
      hiddenCount: Math.max(0, sorted.length - representative.length),
    });
  }
  return clusters;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(?:단독|종합|속보|특징주)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortByDateDesc<T extends { publishedAt: string }>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function compact(value: string, max: number): string {
  const oneLine = value.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function resolveStringSimilarity(): StringSimilarityFn {
  if (typeof stringSimilarityExports.stringSimilarity === 'function') {
    return stringSimilarityExports.stringSimilarity as StringSimilarityFn;
  }
  if (typeof stringSimilarityExports.default === 'function') {
    return stringSimilarityExports.default as StringSimilarityFn;
  }
  return (left, right) => (left === right ? 1 : 0);
}

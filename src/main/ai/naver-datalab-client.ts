import Bottleneck from 'bottleneck';
import { type EventLogger, logExternalApiFailure } from '../logging/event-logger';

export type NaverDatalabTimeUnit = 'date' | 'week' | 'month';

export interface NaverDatalabKeywordGroup {
  /** caller-side key, e.g. pdno. */
  key: string;
  groupName: string;
  keywords: string[];
}

export interface NaverDatalabTrendPoint {
  period: string;
  ratio: number;
}

export interface NaverSearchTrendSummary {
  key: string;
  title: string;
  keywords: string[];
  startDate: string;
  endDate: string;
  timeUnit: NaverDatalabTimeUnit;
  latestPeriod: string | null;
  latestRatio: number | null;
  previousRatio: number | null;
  averageRatio: number | null;
  maxRatio: number | null;
  minRatio: number | null;
  changeFromPrevious: number | null;
  changeFromAverage: number | null;
  slope: number | null;
}

export interface NaverDatalabClientOptions {
  logger: EventLogger;
  /** Naver Developers application client id. */
  naverClientId: string;
  naverClientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface NaverDatalabSummaryOptions {
  days?: number;
  timeUnit?: NaverDatalabTimeUnit;
  startDate?: string;
  endDate?: string;
}

const NAVER_DATALAB_SEARCH_URL = 'https://openapi.naver.com/v1/datalab/search';
const MAX_KEYWORD_GROUPS_PER_REQUEST = 5;

export class NaverDatalabClient {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: Bottleneck;

  constructor(private readonly opts: NaverDatalabClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: 120 });
  }

  isAvailable(): boolean {
    return this.opts.naverClientId.length > 0 && this.opts.naverClientSecret.length > 0;
  }

  async getTrendSummaries(
    groups: ReadonlyArray<NaverDatalabKeywordGroup>,
    options: NaverDatalabSummaryOptions = {},
  ): Promise<Map<string, NaverSearchTrendSummary>> {
    const normalized = normalizeGroups(groups);
    const out = new Map<string, NaverSearchTrendSummary>();
    if (!this.isAvailable() || normalized.length === 0) return out;

    const range = resolveDateRange(options, this.now());
    for (let i = 0; i < normalized.length; i += MAX_KEYWORD_GROUPS_PER_REQUEST) {
      const batch = normalized.slice(i, i + MAX_KEYWORD_GROUPS_PER_REQUEST);
      const summaries = await this.fetchBatch(batch, {
        startDate: range.startDate,
        endDate: range.endDate,
        timeUnit: options.timeUnit ?? 'date',
      });
      for (const summary of summaries) out.set(summary.key, summary);
    }
    return out;
  }

  private async fetchBatch(
    groups: ReadonlyArray<NaverDatalabKeywordGroup>,
    options: Required<Pick<NaverDatalabSummaryOptions, 'startDate' | 'endDate' | 'timeUnit'>>,
  ): Promise<NaverSearchTrendSummary[]> {
    if (groups.length === 0) return [];
    const startedAt = Date.now();
    const body = {
      startDate: options.startDate,
      endDate: options.endDate,
      timeUnit: options.timeUnit,
      keywordGroups: groups.map((group) => ({
        groupName: group.groupName,
        keywords: group.keywords,
      })),
    };

    try {
      const res = await this.limiter.schedule(() =>
        this.fetchImpl(NAVER_DATALAB_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Naver-Client-Id': this.opts.naverClientId,
            'X-Naver-Client-Secret': this.opts.naverClientSecret,
          },
          body: JSON.stringify(body),
        }),
      );
      if (!res.ok) {
        this.logFail(`HTTP ${res.status}`, {
          status: res.status,
          durationMs: Date.now() - startedAt,
        });
        return [];
      }
      const json = (await res.json()) as NaverDatalabResponse;
      const results = Array.isArray(json.results) ? json.results : [];
      return results.map((result, index) =>
        summarizeResult(
          groups[index],
          result,
          options.startDate,
          options.endDate,
          options.timeUnit,
        ),
      );
    } catch (cause) {
      this.logFail(cause, { durationMs: Date.now() - startedAt });
      return [];
    }
  }

  private logFail(reason: unknown, meta: { status?: number; durationMs?: number } = {}): void {
    logExternalApiFailure(this.opts.logger, {
      source: 'naver-datalab',
      endpoint: NAVER_DATALAB_SEARCH_URL,
      status: meta.status ?? null,
      reason: reason instanceof Error ? reason.message : String(reason),
      durationMs: meta.durationMs,
    });
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }
}

interface NaverDatalabResponse {
  results?: NaverDatalabRawResult[];
}

interface NaverDatalabRawResult {
  title: string;
  keywords: string[];
  data: Array<{ period: string; ratio: number }>;
}

function normalizeGroups(
  groups: ReadonlyArray<NaverDatalabKeywordGroup>,
): NaverDatalabKeywordGroup[] {
  const out: NaverDatalabKeywordGroup[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const key = group.key.trim();
    if (!key || seen.has(key)) continue;
    const keywords = [
      ...new Set(group.keywords.map((keyword) => keyword.trim()).filter(Boolean)),
    ].slice(0, 20);
    if (keywords.length === 0) continue;
    out.push({
      key,
      groupName: group.groupName.trim() || key,
      keywords,
    });
    seen.add(key);
  }
  return out;
}

function resolveDateRange(
  options: NaverDatalabSummaryOptions,
  now: Date,
): { startDate: string; endDate: string } {
  if (options.startDate && options.endDate) {
    return { startDate: options.startDate, endDate: options.endDate };
  }
  const days = clampInt(options.days ?? 30, 7, 365);
  const end = options.endDate ?? ymd(shiftDays(now, -1));
  const start = options.startDate ?? ymd(shiftDays(new Date(`${end}T00:00:00+09:00`), -(days - 1)));
  return { startDate: start, endDate: end };
}

function summarizeResult(
  group: NaverDatalabKeywordGroup | undefined,
  result: NaverDatalabRawResult,
  startDate: string,
  endDate: string,
  timeUnit: NaverDatalabTimeUnit,
): NaverSearchTrendSummary {
  const data = result.data.map((point) => ({
    period: point.period,
    ratio: Number.isFinite(point.ratio) ? point.ratio : 0,
  }));
  const ratios = data.map((point) => point.ratio);
  const latest = data.at(-1) ?? null;
  const previous = data.at(-2) ?? null;
  const firstRatio = ratios[0] ?? null;
  const average =
    ratios.length > 0
      ? round2(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length)
      : null;
  const max = ratios.length > 0 ? round2(Math.max(...ratios)) : null;
  const min = ratios.length > 0 ? round2(Math.min(...ratios)) : null;
  const latestRatio = latest ? round2(latest.ratio) : null;
  const previousRatio = previous ? round2(previous.ratio) : null;
  return {
    key: group?.key ?? result.title,
    title: result.title,
    keywords: result.keywords,
    startDate,
    endDate,
    timeUnit,
    latestPeriod: latest?.period ?? null,
    latestRatio,
    previousRatio,
    averageRatio: average,
    maxRatio: max,
    minRatio: min,
    changeFromPrevious:
      latestRatio !== null && previousRatio !== null ? round2(latestRatio - previousRatio) : null,
    changeFromAverage:
      latestRatio !== null && average !== null ? round2(latestRatio - average) : null,
    slope: latest !== null && firstRatio !== null ? round2(latest.ratio - firstRatio) : null,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function ymd(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

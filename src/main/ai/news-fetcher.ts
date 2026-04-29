import Bottleneck from 'bottleneck';
import { decode } from 'html-entities';
import { type EventLogger, logExternalApiFailure } from '../logging/event-logger';

export interface NewsItem {
  /** 발행 일자 (KST, YYYY-MM-DD HH:mm). */
  publishedAt: string;
  title: string;
  /** 한 줄 요약 (Naver 가 description 으로 제공). HTML 태그 제거됨. */
  summary: string;
  link: string;
}

export interface NewsFetcherOptions {
  logger: EventLogger;
  /** 빌드 임베드: process.env.NAVER_CLIENT_ID. 빈 문자열이면 isAvailable=false. */
  naverClientId: string;
  naverClientSecret: string;
  fetchImpl?: typeof fetch;
}

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
export type NewsSort = 'date' | 'sim';

export interface NewsSearchOptions {
  query: string;
  /** Naver display: 1~100. */
  display?: number;
  /** Naver start: 1~1000. */
  start?: number;
  sort?: NewsSort;
}

/**
 * Naver Open API 기반 뉴스 조회 — 사용자 BYO X, 빌드 임베드 키 사용.
 *
 * 무료 한도: 25,000 호출/일. AI 추천 한 번당 최대 5건 사용 시 일 5,000회 추천 가능.
 * 키 미설정 시 isAvailable=false → 호출자 graceful skip.
 *
 * 참고:
 *  - Naver 응답은 HTML entity / b 태그 포함 — 제거 후 반환.
 *  - display/start/sort 옵션을 열어 호출자가 evidence budget 을 제어.
 */
export class NewsFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: Bottleneck;

  constructor(private readonly opts: NewsFetcherOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: 120 });
  }

  isAvailable(): boolean {
    return this.opts.naverClientId.length > 0 && this.opts.naverClientSecret.length > 0;
  }

  /**
   * 종목명 키워드로 최신 뉴스 max 건 조회. 실패 시 빈 배열 (graceful).
   */
  async searchByKeyword(keyword: string, max = 5): Promise<NewsItem[]> {
    return this.search({ query: keyword, display: max, sort: 'date' });
  }

  async search(options: NewsSearchOptions): Promise<NewsItem[]> {
    const query = options.query.trim();
    if (!this.isAvailable() || !query) return [];
    const startedAt = Date.now();
    const display = clampInt(options.display ?? 10, 1, 100);
    const start = clampInt(options.start ?? 1, 1, 1000);
    const sort = options.sort ?? 'date';
    const params = new URLSearchParams({
      query,
      display: String(display),
      start: String(start),
      sort,
    });
    const url = `${NAVER_NEWS_URL}?${params.toString()}`;
    try {
      const res = await this.limiter.schedule(() =>
        this.fetchImpl(url, {
          headers: {
            'X-Naver-Client-Id': this.opts.naverClientId,
            'X-Naver-Client-Secret': this.opts.naverClientSecret,
          },
        }),
      );
      if (!res.ok) {
        this.logFail(`HTTP ${res.status}`, {
          status: res.status,
          durationMs: Date.now() - startedAt,
        });
        return [];
      }
      const json = (await res.json()) as { items?: NaverNewsRaw[] };
      return (json.items ?? []).slice(0, display).map(toNewsItem);
    } catch (cause) {
      this.logFail(cause, { durationMs: Date.now() - startedAt });
      return [];
    }
  }

  private logFail(reason: unknown, meta: { status?: number; durationMs?: number } = {}): void {
    logExternalApiFailure(this.opts.logger, {
      source: 'naver-news',
      endpoint: NAVER_NEWS_URL,
      status: meta.status ?? null,
      reason: reason instanceof Error ? reason.message : String(reason),
      durationMs: meta.durationMs,
    });
  }
}

interface NaverNewsRaw {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string; // RFC1123 e.g. "Tue, 01 Apr 2026 09:00:00 +0900"
}

function toNewsItem(raw: NaverNewsRaw): NewsItem {
  return {
    publishedAt: parseRfcDate(raw.pubDate),
    title: stripHtml(raw.title),
    summary: stripHtml(raw.description),
    link: raw.originallink || raw.link,
  };
}

function stripHtml(s: string): string {
  return decode(s.replace(/<[^>]*>/g, '')).trim();
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseRfcDate(s: string): string {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return s;
  }
}

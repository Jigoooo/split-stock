import type { EventLogger } from '../logging/event-logger';

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

/**
 * Naver Open API 기반 뉴스 조회 — 사용자 BYO X, 빌드 임베드 키 사용.
 *
 * 무료 한도: 25,000 호출/일. AI 추천 한 번당 최대 5건 사용 시 일 5,000회 추천 가능.
 * 키 미설정 시 isAvailable=false → 호출자 graceful skip.
 *
 * 참고:
 *  - Naver 응답은 HTML entity / b 태그 포함 — 제거 후 반환.
 *  - 정렬 'date' 로 최신순. display max 5.
 */
export class NewsFetcher {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: NewsFetcherOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isAvailable(): boolean {
    return this.opts.naverClientId.length > 0 && this.opts.naverClientSecret.length > 0;
  }

  /**
   * 종목명 키워드로 최신 뉴스 max 건 조회. 실패 시 빈 배열 (graceful).
   */
  async searchByKeyword(keyword: string, max = 5): Promise<NewsItem[]> {
    if (!this.isAvailable() || !keyword.trim()) return [];
    const url = `${NAVER_NEWS_URL}?query=${encodeURIComponent(keyword)}&display=${max}&sort=date`;
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          'X-Naver-Client-Id': this.opts.naverClientId,
          'X-Naver-Client-Secret': this.opts.naverClientSecret,
        },
      });
      if (!res.ok) {
        this.logFail('http', `${res.status}`);
        return [];
      }
      const json = (await res.json()) as { items?: NaverNewsRaw[] };
      return (json.items ?? []).slice(0, max).map(toNewsItem);
    } catch (cause) {
      this.logFail('exception', cause);
      return [];
    }
  }

  private logFail(scope: 'http' | 'exception', detail: unknown): void {
    this.opts.logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'news.fetch.failed',
      payload: { scope, detail: String(detail).slice(0, 300) },
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
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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

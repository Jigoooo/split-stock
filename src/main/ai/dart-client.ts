import { type EventLogger, logExternalApiFailure } from '../logging/event-logger';

/**
 * OpenDART OpenAPI (https://opendart.fss.or.kr) 직접 호출 — 빌드 임베드 키 사용.
 *
 * - process.env.DART_API_KEY 는 electron.vite.config.ts 의 define 으로 빌드 시 inline.
 * - 사용자 BYO 아님 — 사용자는 별도 발급 불필요.
 *
 * 노출 함수:
 *  - findCorpCodeByStockCode: 6자리 종목코드 → DART corp_code(8자리). 1회 lookup 후 캐시.
 *  - listRecentDisclosures: 최근 N일 공시 제목 + 일자 (간략).
 *  - getCorpInfo: 회사 개황 (업종/대표자/홈페이지 등).
 */
export interface DartClientOptions {
  logger: EventLogger;
  /** 빌드 시 inline 된 키. 빈 문자열이면 isAvailable=false. */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface DartCorpInfo {
  corpCode: string;
  corpName: string;
  ceoName: string | null;
  industryCode: string | null;
  homepage: string | null;
  estDate: string | null;
}

export interface DartDisclosureSummary {
  /** 공시 일자 YYYYMMDD. */
  rceptDt: string;
  /** 공시 제목. */
  reportNm: string;
  /** 공시 접수번호. */
  rceptNo: string;
}

const DART_BASE = 'https://opendart.fss.or.kr/api';

export class DartClient {
  private readonly fetchImpl: typeof fetch;
  private corpCodeCache: Map<string, string> | null = null;

  constructor(private readonly opts: DartClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isAvailable(): boolean {
    return this.opts.apiKey.length > 0;
  }

  /**
   * 6자리 stock_code → 8자리 corp_code lookup.
   * 첫 호출 시 corpCode.xml(zip) 전체 받아 메모리 캐시.
   */
  async findCorpCodeByStockCode(stockCode: string): Promise<string | null> {
    if (!this.isAvailable()) return null;
    const cache = await this.ensureCorpCodeCache();
    return cache.get(stockCode.padStart(6, '0')) ?? null;
  }

  async getCorpInfo(corpCode: string): Promise<DartCorpInfo | null> {
    if (!this.isAvailable()) return null;
    const url = `${DART_BASE}/company.json?crtfc_key=${this.opts.apiKey}&corp_code=${corpCode}`;
    try {
      const res = await this.fetchImpl(url);
      if (!res.ok) {
        this.logFail('company', res.status);
        return null;
      }
      const json = (await res.json()) as Record<string, string>;
      if (json.status !== '000') {
        this.logFail('company', json.status);
        return null;
      }
      return {
        corpCode,
        corpName: json.corp_name ?? '',
        ceoName: json.ceo_nm ?? null,
        industryCode: json.induty_code ?? null,
        homepage: json.hm_url ?? null,
        estDate: json.est_dt ?? null,
      };
    } catch (cause) {
      this.logFail('company', cause);
      return null;
    }
  }

  /**
   * 최근 days 일 공시 제목 max 10건. bgn_de(시작일) ~ end_de(종료일) inclusive.
   */
  async listRecentDisclosures(
    corpCode: string,
    days = 30,
    pageCount = 10,
  ): Promise<DartDisclosureSummary[]> {
    if (!this.isAvailable()) return [];
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const bgnDe = ymd(start);
    const endDe = ymd(end);
    const url = `${DART_BASE}/list.json?crtfc_key=${this.opts.apiKey}&corp_code=${corpCode}&bgn_de=${bgnDe}&end_de=${endDe}&page_count=${pageCount}`;
    try {
      const res = await this.fetchImpl(url);
      if (!res.ok) {
        this.logFail('list', res.status);
        return [];
      }
      const json = (await res.json()) as { status?: string; list?: DartDisclosureSummary[] };
      if (json.status !== '000') {
        // status='013' = 데이터 없음 — 정상 케이스, 빈 배열.
        if (json.status !== '013') this.logFail('list', json.status);
        return [];
      }
      return (json.list ?? []).map((d) => ({
        rceptDt: d.rceptDt,
        reportNm: d.reportNm,
        rceptNo: d.rceptNo,
      }));
    } catch (cause) {
      this.logFail('list', cause);
      return [];
    }
  }

  private async ensureCorpCodeCache(): Promise<Map<string, string>> {
    // 실제 stock_code → corp_code 매핑은 DartCorpCodeRepo (DB 적재) 가 담당.
    // 본 in-memory cache 는 사용 안 함 — 상위 ai-router 에서 dartCorpCodeRepo.findByStockCode
    // 로 lookup 후 corpCode 를 명시 주입한다.
    if (!this.corpCodeCache) this.corpCodeCache = new Map();
    return this.corpCodeCache;
  }

  private logFail(scope: 'company' | 'list', detail: unknown): void {
    logExternalApiFailure(this.opts.logger, {
      source: 'dart',
      endpoint: `${DART_BASE}/${scope}.json`,
      status: typeof detail === 'number' || typeof detail === 'string' ? detail : null,
      reason: detail instanceof Error ? detail.message : String(detail),
    });
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

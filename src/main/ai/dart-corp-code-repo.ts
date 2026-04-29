import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { dartCorpCodes } from '../db/schema';
import { type EventLogger, logExternalApiFailure } from '../logging/event-logger';

export interface DartCorpCodeEntry {
  stockCode: string;
  corpCode: string;
  corpName: string;
  modifyDate: string | null;
}

export interface DartCorpCodeRepoOptions {
  db: Db;
  logger: EventLogger;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const DART_CORP_CODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
const STALE_MS = 24 * 60 * 60 * 1000; // 1일

/**
 * DART corp_code 매핑 저장소 + sync 파이프라인.
 *
 * - sync(): zip 다운로드 → corpCode.xml 추출 → 상장 종목만 upsert
 * - findByStockCode(): DB lookup
 * - isStale(): 1일 이상 갱신 안 됐으면 true
 *
 * XML 은 flat 구조라 별도 파서 없이 정규식으로 파싱 — 의존성 추가 회피.
 */
export class DartCorpCodeRepo {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: DartCorpCodeRepoOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isAvailable(): boolean {
    return this.opts.apiKey.length > 0;
  }

  findByStockCode(stockCode: string): DartCorpCodeEntry | null {
    const padded = stockCode.padStart(6, '0');
    const row = this.opts.db
      .select()
      .from(dartCorpCodes)
      .where(eq(dartCorpCodes.stockCode, padded))
      .get();
    if (!row) return null;
    return {
      stockCode: row.stockCode,
      corpCode: row.corpCode,
      corpName: row.corpName,
      modifyDate: row.modifyDate ?? null,
    };
  }

  /** 마지막 sync 후 1일 이상 경과하거나 데이터 없으면 stale. */
  isStale(): boolean {
    const sample = this.opts.db.select().from(dartCorpCodes).limit(1).get();
    if (!sample) return true;
    const ageMs = Date.now() - sample.fetchedAt.getTime();
    return ageMs > STALE_MS;
  }

  /**
   * OpenDART corpCode 전체 sync. 약 1.5MB zip → ~3MB XML → 100K+ 회사 (상장은 ~3K).
   * 한 번 받으면 당일 재사용. UI '갱신' 버튼 또는 부팅 시 stale 검사로 호출.
   */
  async sync(): Promise<{ inserted: number; reason?: string }> {
    if (!this.isAvailable()) {
      return { inserted: 0, reason: 'DART_API_KEY 미설정' };
    }
    try {
      const url = `${DART_CORP_CODE_URL}?crtfc_key=${this.opts.apiKey}`;
      const res = await this.fetchImpl(url);
      if (!res.ok) {
        this.logFail('http', `${res.status}`);
        return { inserted: 0, reason: `DART HTTP ${res.status}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // DART 가 키 오류 시 zip 대신 JSON 에러를 반환하는 케이스 처리.
      if (buf.length < 1024) {
        const maybeJson = buf.toString('utf-8');
        if (maybeJson.startsWith('{')) {
          this.logFail('payload', maybeJson.slice(0, 200));
          return { inserted: 0, reason: 'DART 응답이 zip 이 아님 (키/할당량 확인)' };
        }
      }
      const zip = new AdmZip(buf);
      const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith('.xml'));
      if (!xmlEntry) {
        this.logFail('zip', 'xml entry 없음');
        return { inserted: 0, reason: 'zip 에 xml 엔트리 없음' };
      }
      const xml = xmlEntry.getData().toString('utf-8');
      const entries = parseDartCorpXml(xml);

      const now = new Date();
      this.opts.db.transaction(() => {
        // 단순화 — 전체 삭제 후 재삽입. 3K rows 라 SQLite 1초 미만.
        this.opts.db.delete(dartCorpCodes).run();
        if (entries.length === 0) return;
        const chunkSize = 500;
        for (let i = 0; i < entries.length; i += chunkSize) {
          const chunk = entries.slice(i, i + chunkSize);
          this.opts.db
            .insert(dartCorpCodes)
            .values(
              chunk.map((e) => ({
                stockCode: e.stockCode,
                corpCode: e.corpCode,
                corpName: e.corpName,
                modifyDate: e.modifyDate,
                fetchedAt: now,
              })),
            )
            .run();
        }
      });

      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'dart.corp-code.synced',
        payload: { inserted: entries.length },
      });
      return { inserted: entries.length };
    } catch (cause) {
      this.logFail('exception', cause);
      return {
        inserted: 0,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  private logFail(scope: string, detail: unknown): void {
    logExternalApiFailure(this.opts.logger, {
      source: 'dart',
      endpoint: DART_CORP_CODE_URL,
      status: null,
      reason: `${scope}: ${detail instanceof Error ? detail.message : String(detail)}`,
    });
  }
}

/**
 * 상장 종목(stock_code 비어있지 않은) 만 추출. 비상장 회사는 매직스플릿 대상 아님.
 *
 * XML 구조 (flat):
 *   <list>
 *     <corp_code>00126380</corp_code>
 *     <corp_name>삼성전자</corp_name>
 *     <stock_code>005930</stock_code>
 *     <modify_date>20240605</modify_date>
 *   </list>
 */
export function parseDartCorpXml(xml: string): DartCorpCodeEntry[] {
  const result: DartCorpCodeEntry[] = [];
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match: RegExpExecArray | null;
  match = listRegex.exec(xml);
  while (match !== null) {
    const block = match[1] ?? '';
    const corpCode = matchTag(block, 'corp_code');
    const corpName = matchTag(block, 'corp_name');
    const stockCode = matchTag(block, 'stock_code');
    const modifyDate = matchTag(block, 'modify_date');
    if (corpCode && corpName && stockCode) {
      result.push({
        stockCode: stockCode.padStart(6, '0'),
        corpCode,
        corpName,
        modifyDate: modifyDate || null,
      });
    }
    match = listRegex.exec(xml);
  }
  return result;
}

function matchTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(block);
  if (!m?.[1]) return '';
  return m[1].trim();
}

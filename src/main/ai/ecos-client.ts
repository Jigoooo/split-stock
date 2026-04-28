import type { EventLogger } from '../logging/event-logger';

export type EcosFrequency = 'A' | 'S' | 'Q' | 'M' | 'SM' | 'D';

export interface EcosClientOptions {
  logger: EventLogger;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface EcosSeriesRequest {
  indicator: string;
  statCode: string;
  itemCode: string;
  frequency: EcosFrequency;
  start: string;
  end: string;
  count?: number;
}

export interface EcosSeriesPoint {
  indicator: string;
  statCode: string;
  itemCode: string;
  frequency: EcosFrequency;
  date: string;
  value: number;
  unitName: string | null;
}

const ECOS_BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';

export class EcosClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: EcosClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isAvailable(): boolean {
    return this.opts.apiKey.length > 0;
  }

  async getRecentSeries(req: EcosSeriesRequest): Promise<EcosSeriesPoint[]> {
    if (!this.isAvailable()) {
      throw new Error('ECOS_API_KEY 미설정');
    }
    const count = Math.max(1, Math.min(req.count ?? 100, 1000));
    const url = [
      ECOS_BASE,
      encodeURIComponent(this.opts.apiKey),
      'json',
      'kr',
      '1',
      String(count),
      encodeURIComponent(req.statCode),
      encodeURIComponent(req.frequency),
      encodeURIComponent(req.start),
      encodeURIComponent(req.end),
      encodeURIComponent(req.itemCode),
    ].join('/');

    try {
      const res = await this.fetchImpl(url);
      if (!res.ok) {
        throw new Error(`ECOS HTTP ${res.status}`);
      }
      const json = (await res.json()) as EcosResponse;
      const rows = json.StatisticSearch?.row;
      if (!Array.isArray(rows)) {
        throw new Error('ECOS 응답에 StatisticSearch.row 없음');
      }
      return rows.map((row) => ({
        indicator: req.indicator,
        statCode: req.statCode,
        itemCode: req.itemCode,
        frequency: req.frequency,
        date: row.TIME,
        value: parseValue(row.DATA_VALUE),
        unitName: row.UNIT_NAME?.trim() || null,
      }));
    } catch (cause) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'ecos.fetch.failed',
        payload: { detail: cause instanceof Error ? cause.message : String(cause) },
      });
      throw cause;
    }
  }
}

interface EcosResponse {
  StatisticSearch?: {
    row?: Array<{
      TIME: string;
      DATA_VALUE: string;
      UNIT_NAME?: string;
    }>;
  };
}

function parseValue(value: string): number {
  const n = Number(value.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    throw new Error(`ECOS DATA_VALUE 파싱 실패: ${value}`);
  }
  return n;
}

import type { EventLogger } from '../logging/event-logger';

export type KrxMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX';

export interface KrxClientOptions {
  logger: EventLogger;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface KrxDailyTradeRow {
  market: KrxMarket;
  date: string;
  pdno: string;
  name: string;
  close: number | null;
  change: number | null;
  changeRate: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  tradeValue: number | null;
  marketCap: number | null;
  listedShares: number | null;
}

export interface KrxBaseInfoRow {
  market: KrxMarket;
  date: string;
  isin: string | null;
  pdno: string;
  name: string;
  shortName: string | null;
  englishName: string | null;
  listedAt: string | null;
  marketName: string | null;
  securityGroup: string | null;
  section: string | null;
  stockKind: string | null;
  parValue: string | null;
  listedShares: number | null;
}

const KRX_DAILY_TRADE_URL: Record<KrxMarket, string> = {
  KOSPI: 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd',
  KOSDAQ: 'https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd',
  KONEX: 'https://data-dbg.krx.co.kr/svc/apis/sto/knx_bydd_trd',
};

const KRX_BASE_INFO_URL: Record<KrxMarket, string> = {
  KOSPI: 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info',
  KOSDAQ: 'https://data-dbg.krx.co.kr/svc/apis/sto/ksq_isu_base_info',
  KONEX: 'https://data-dbg.krx.co.kr/svc/apis/sto/knx_isu_base_info',
};

export class KrxClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: KrxClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isAvailable(): boolean {
    return this.opts.apiKey.length > 0;
  }

  async getDailyTradeInfo(input: {
    market: KrxMarket;
    basDd: string;
    pdnos?: ReadonlyArray<string>;
  }): Promise<KrxDailyTradeRow[]> {
    const raw = await this.fetchOutBlock(KRX_DAILY_TRADE_URL[input.market], input.basDd);
    const filter = toPdnoSet(input.pdnos);
    return raw
      .map((row) => toDailyTradeRow(input.market, row))
      .filter((row) => (filter ? filter.has(row.pdno) : true));
  }

  async getBaseInfo(input: {
    market: KrxMarket;
    basDd: string;
    pdnos?: ReadonlyArray<string>;
  }): Promise<KrxBaseInfoRow[]> {
    const raw = await this.fetchOutBlock(KRX_BASE_INFO_URL[input.market], input.basDd);
    const filter = toPdnoSet(input.pdnos);
    return raw
      .map((row) => toBaseInfoRow(input.market, input.basDd, row))
      .filter((row) => (filter ? filter.has(row.pdno) : true));
  }

  private async fetchOutBlock(url: string, basDd: string): Promise<Array<Record<string, string>>> {
    if (!this.isAvailable()) {
      throw new Error('KRX_API_KEY 미설정');
    }
    try {
      const res = await this.fetchImpl(`${url}?basDd=${encodeURIComponent(basDd)}`, {
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: this.opts.apiKey,
        },
      });
      if (!res.ok) {
        throw new Error(`KRX HTTP ${res.status}`);
      }
      const json = (await res.json()) as { OutBlock_1?: Array<Record<string, string>> };
      if (!Array.isArray(json.OutBlock_1)) {
        throw new Error('KRX 응답에 OutBlock_1 없음');
      }
      return json.OutBlock_1;
    } catch (cause) {
      this.opts.logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'krx.fetch.failed',
        payload: { detail: cause instanceof Error ? cause.message : String(cause) },
      });
      throw cause;
    }
  }
}

function toPdnoSet(pdnos: ReadonlyArray<string> | undefined): Set<string> | null {
  if (!pdnos || pdnos.length === 0) return null;
  return new Set(pdnos.map((p) => p.padStart(6, '0')));
}

function toDailyTradeRow(market: KrxMarket, row: Record<string, string>): KrxDailyTradeRow {
  return {
    market,
    date: ymd8ToIso(row.BAS_DD),
    pdno: (row.ISU_CD ?? '').padStart(6, '0'),
    name: row.ISU_NM ?? '',
    close: parseNum(row.TDD_CLSPRC),
    change: parseNum(row.CMPPREVDD_PRC),
    changeRate: parseNum(row.FLUC_RT),
    open: parseNum(row.TDD_OPNPRC),
    high: parseNum(row.TDD_HGPRC),
    low: parseNum(row.TDD_LWPRC),
    volume: parseNum(row.ACC_TRDVOL),
    tradeValue: parseNum(row.ACC_TRDVAL),
    marketCap: parseNum(row.MKTCAP),
    listedShares: parseNum(row.LIST_SHRS),
  };
}

function toBaseInfoRow(market: KrxMarket, basDd: string, row: Record<string, string>): KrxBaseInfoRow {
  return {
    market,
    date: ymd8ToIso(basDd),
    isin: nonEmpty(row.ISU_CD),
    pdno: (row.ISU_SRT_CD ?? '').padStart(6, '0'),
    name: row.ISU_NM ?? '',
    shortName: nonEmpty(row.ISU_ABBRV),
    englishName: nonEmpty(row.ISU_ENG_NM),
    listedAt: ymd8ToIsoOrNull(row.LIST_DD),
    marketName: nonEmpty(row.MKT_TP_NM),
    securityGroup: nonEmpty(row.SECUGRP_NM),
    section: nonEmpty(row.SECT_TP_NM),
    stockKind: nonEmpty(row.KIND_STKCERT_TP_NM),
    parValue: nonEmpty(row.PARVAL),
    listedShares: parseNum(row.LIST_SHRS),
  };
}

function parseNum(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized || normalized === '-') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function ymd8ToIso(value: string | undefined): string {
  return ymd8ToIsoOrNull(value) ?? '';
}

function ymd8ToIsoOrNull(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

import type { AppEnv, KisError } from '@shared/contracts';
import {
  KisBalanceResponseSchema,
  KisDailyChartResponseSchema,
  KisPriceResponseSchema,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { KIS_PATH, trId } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';
import type { KisHttpClient } from './http-client';

export interface Position {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

export interface BalanceResult {
  positions: Position[];
  deposit: number; // 예수금 총액
  totalEval: number; // 총평가금액
}

export interface QuoteResult {
  code: string;
  price: number;
  dayChange: number;
  dayChangeRate: number;
  accumVolume: number;
}

export interface DailyCandle {
  date: string; // ISO YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DomesticStockDeps {
  http: KisHttpClient;
  env: AppEnv;
  token: string;
  appKey: string;
  appSecret: string;
  accountNo8: string;
  accountProdCd: string;
}

function authHeaders(deps: DomesticStockDeps, trIdValue: string): Record<string, string> {
  return {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: trIdValue,
    custtype: 'P',
  };
}

function parseNum(x: string | undefined): number {
  if (!x) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 국내주식 잔고조회 — inquire-balance.
 * 응답 output1(보유종목)과 output2(계좌 요약)를 Position[]와 예수금/총평가로 정규화.
 */
export async function inquireBalance(
  deps: DomesticStockDeps,
): Promise<Result<BalanceResult, KisError>> {
  const headers = authHeaders(deps, trId('BALANCE', deps.env));
  const params: Record<string, string> = {
    CANO: deps.accountNo8,
    ACNT_PRDT_CD: deps.accountProdCd,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '02',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '00',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  };
  const res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_BALANCE, params, headers);
  if (res.isErr()) return err(res.error);
  const parsed = KisBalanceResponseSchema.safeParse(res.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'balance response malformed', {
        cause: parsed.error.message,
      }),
    );
  }
  const bizErr = interpretRtCd(parsed.data.rt_cd, parsed.data.msg_cd, parsed.data.msg1);
  if (bizErr) return err(bizErr);

  const positions: Position[] = parsed.data.output1.map((row) => ({
    code: row.pdno,
    name: row.prdt_name,
    qty: parseNum(row.hldg_qty),
    avgPrice: parseNum(row.pchs_avg_pric),
    currentPrice: parseNum(row.prpr),
    evalAmount: parseNum(row.evlu_amt),
    pnlAmount: parseNum(row.evlu_pfls_amt),
    pnlRate: parseNum(row.evlu_pfls_rt),
  }));
  const summary = parsed.data.output2[0];
  return ok({
    positions,
    deposit: parseNum(summary?.dnca_tot_amt),
    totalEval: parseNum(summary?.tot_evlu_amt),
  });
}

/**
 * 국내주식 현재가 시세 — inquire-price.
 * TR_ID는 FHKST01010100 (조회성 TR, 실전/모의 공통).
 */
export async function inquirePrice(
  deps: DomesticStockDeps,
  code: string,
): Promise<Result<QuoteResult, KisError>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: 'FHKST01010100',
    custtype: 'P',
  };
  const params = {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: code,
  };
  const res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_PRICE, params, headers);
  if (res.isErr()) return err(res.error);
  const parsed = KisPriceResponseSchema.safeParse(res.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'price response malformed', {
        cause: parsed.error.message,
      }),
    );
  }
  const bizErr = interpretRtCd(parsed.data.rt_cd, parsed.data.msg_cd, parsed.data.msg1);
  if (bizErr) return err(bizErr);
  return ok({
    code,
    price: parseNum(parsed.data.output.stck_prpr),
    dayChange: parseNum(parsed.data.output.prdy_vrss),
    dayChangeRate: parseNum(parsed.data.output.prdy_ctrt),
    accumVolume: parseNum(parsed.data.output.acml_vol),
  });
}

function toIsoDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 일봉 조회 — inquire-daily-itemchartprice.
 * TR_ID: FHKST03010100 (조회성, 실전/모의 공통).
 * KIS 응답 output2는 최신 날짜부터 역순. 오래된 순으로 정렬하여 반환.
 */
export async function inquireDailyChart(
  deps: Omit<DomesticStockDeps, 'accountNo8' | 'accountProdCd'>,
  params: { code: string; from: Date; to: Date },
): Promise<Result<DailyCandle[], KisError>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: 'FHKST03010100',
    custtype: 'P',
  };
  const query = {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: params.code,
    FID_INPUT_DATE_1: yyyymmdd(params.from),
    FID_INPUT_DATE_2: yyyymmdd(params.to),
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: '0',
  };
  const res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_DAILY_CHART, query, headers);
  if (res.isErr()) return err(res.error);
  const parsed = KisDailyChartResponseSchema.safeParse(res.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'daily chart 응답 파싱 실패', { cause: parsed.error.message }),
    );
  }
  const bizErr = interpretRtCd(parsed.data.rt_cd, parsed.data.msg_cd, parsed.data.msg1);
  if (bizErr) return err(bizErr);

  const candles: DailyCandle[] = parsed.data.output2
    .map((row) => ({
      date: toIsoDate(row.stck_bsop_date),
      open: parseNum(row.stck_oprc),
      high: parseNum(row.stck_hgpr),
      low: parseNum(row.stck_lwpr),
      close: parseNum(row.stck_clpr),
      volume: parseNum(row.acml_vol),
    }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return ok(candles);
}

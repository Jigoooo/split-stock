import type { AppEnv, KisError } from '@shared/contracts';
import {
  KisBalanceResponseSchema,
  KisDailyChartResponseSchema,
  KisPriceResponseSchema,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { KIS_PATH, trId } from './endpoints';
import { interpretRtCd, isRetryable, makeKisError } from './errors';
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
  /** 시가. 응답 미제공 시 0. */
  open: number;
  /** 당일 고가. 응답 미제공 시 0. */
  high: number;
  /** 당일 저가. 응답 미제공 시 0. */
  low: number;
  /** 상한가. 응답 미제공 시 0. */
  upperLimit: number;
  /** 하한가. 응답 미제공 시 0. */
  lowerLimit: number;
  /** 기준가(전일 종가). 응답 미제공 시 0. */
  prevClose: number;
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
 *
 * KIS 잔고 API는 일시적으로 5xx/타임아웃을 뱉을 때가 있어 retryable 에러는
 * 짧은 백오프로 1회 재시도한다 (총 2회 시도). 비즈니스 에러(rt_cd != 0)는 재시도하지 않는다.
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
  let res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_BALANCE, params, headers);
  if (res.isErr() && isRetryable(res.error)) {
    await new Promise((r) => setTimeout(r, 300));
    res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_BALANCE, params, headers);
  }
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
  const out = parsed.data.output;
  return ok({
    code,
    price: parseNum(out.stck_prpr),
    dayChange: parseNum(out.prdy_vrss),
    dayChangeRate: parseNum(out.prdy_ctrt),
    accumVolume: parseNum(out.acml_vol),
    open: parseNum(out.stck_oprc),
    high: parseNum(out.stck_hgpr),
    low: parseNum(out.stck_lwpr),
    upperLimit: parseNum(out.stck_mxpr),
    lowerLimit: parseNum(out.stck_llam),
    prevClose: parseNum(out.stck_sdpr),
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
export type ChartPeriod = 'D' | 'W' | 'M';

export async function inquireDailyChart(
  deps: Omit<DomesticStockDeps, 'accountNo8' | 'accountProdCd'>,
  params: { code: string; from: Date; to: Date; period?: ChartPeriod },
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
    FID_PERIOD_DIV_CODE: params.period ?? 'D',
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

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface OrderbookSnapshot {
  pdno: string;
  time: string; // HHMMSS (스냅샷 시각)
  asks: OrderbookLevel[]; // 매도 1~10호가
  bids: OrderbookLevel[]; // 매수 1~10호가
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number;
  expectedQty: number;
}

/**
 * 주식현재가 호가/예상체결 (REST 스냅샷).
 * TR_ID: FHKST01010200 — 실전/모의 공통.
 * WebSocket(H0STASP0) 데이터가 흐르지 않는 장외 시간대에 fallback으로 사용.
 */
export async function inquireOrderbook(
  deps: Omit<DomesticStockDeps, 'accountNo8' | 'accountProdCd'>,
  pdno: string,
): Promise<Result<OrderbookSnapshot, KisError>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: 'FHKST01010200',
    custtype: 'P',
  };
  const query = {
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: pdno,
  };
  const res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_ASKING_PRICE, query, headers);
  if (res.isErr()) return err(res.error);
  const body = res.value.body as {
    rt_cd?: string;
    msg_cd?: string;
    msg1?: string;
    output1?: Record<string, string>;
    output2?: Record<string, string>;
  };
  const bizErr = interpretRtCd(body.rt_cd ?? '', body.msg_cd ?? '', body.msg1 ?? '');
  if (bizErr) return err(bizErr);
  if (!body.output1) {
    return err(makeKisError('VALIDATION', 'orderbook 응답에 output1 없음'));
  }
  const o1 = body.output1;
  const asks: OrderbookLevel[] = [];
  const bids: OrderbookLevel[] = [];
  for (let i = 1; i <= 10; i++) {
    asks.push({
      price: parseNum(o1[`askp${i}`] ?? '0'),
      quantity: parseNum(o1[`askp_rsqn${i}`] ?? '0'),
    });
    bids.push({
      price: parseNum(o1[`bidp${i}`] ?? '0'),
      quantity: parseNum(o1[`bidp_rsqn${i}`] ?? '0'),
    });
  }
  const o2 = body.output2 ?? {};
  return ok({
    pdno,
    time: o1.aspr_acpt_hour ?? hhmmssNow(),
    asks,
    bids,
    totalAskQty: parseNum(o1.total_askp_rsqn ?? '0'),
    totalBidQty: parseNum(o1.total_bidp_rsqn ?? '0'),
    expectedPrice: parseNum(o2.antc_cnpr ?? '0'),
    expectedQty: parseNum(o2.antc_cnqn ?? '0'),
  });
}

function hhmmssNow(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

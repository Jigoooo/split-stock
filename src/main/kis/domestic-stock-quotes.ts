import type { KisError } from '@shared/contracts';
import { KisPriceResponseSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import {
  authHeaders,
  type DomesticStockQueryDeps,
  hhmmssNow,
  parseNum,
} from './domestic-stock-core';
import { KIS_PATH } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';

export interface QuoteResult {
  code: string;
  price: number;
  dayChange: number;
  dayChangeRate: number;
  accumVolume: number;
  open: number;
  high: number;
  low: number;
  upperLimit: number;
  lowerLimit: number;
  prevClose: number;
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface OrderbookSnapshot {
  pdno: string;
  time: string;
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  totalAskQty: number;
  totalBidQty: number;
  expectedPrice: number;
  expectedQty: number;
}

export async function inquirePrice(
  deps: DomesticStockQueryDeps,
  code: string,
): Promise<Result<QuoteResult, KisError>> {
  const headers = authHeaders(deps, 'FHKST01010100');
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

export async function inquireOrderbook(
  deps: DomesticStockQueryDeps,
  pdno: string,
): Promise<Result<OrderbookSnapshot, KisError>> {
  const headers = authHeaders(deps, 'FHKST01010200');
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

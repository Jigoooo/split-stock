import type { KisError } from '@shared/contracts';
import { KisDailyCcldResponseSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import {
  authHeaders,
  type DomesticStockDeps,
  parseNum,
  resolveDailyCcldTrId,
  yyyymmdd,
} from './domestic-stock-core';
import { KIS_PATH } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';

export interface DailyCcldOrder {
  odno: string;
  orgNo?: string;
  pdno: string;
  name: string;
  side: 'BUY' | 'SELL';
  orderQty: number;
  orderPrice: number;
  orderedAt: string;
  totalFilledQty: number;
  remainingQty: number;
  avgFillPrice: number;
  cancelled: boolean;
  rejectedQty: number;
}

export async function inquireDailyCcld(
  deps: DomesticStockDeps,
  params: {
    from: Date;
    to: Date;
    orderNo?: string;
    code?: string;
    side?: 'ALL' | 'BUY' | 'SELL';
    filledOnly?: boolean;
    ccldDvsn?: '00' | '01' | '02';
    exchange?: 'KRX' | 'NXT' | 'SOR' | 'ALL';
  },
): Promise<Result<DailyCcldOrder[], KisError>> {
  const now = params.to;
  const diffMs = Math.max(0, now.getTime() - params.from.getTime());
  const period = diffMs > 90 * 24 * 60 * 60 * 1000 ? 'before' : 'inner';
  const headers = authHeaders(deps, resolveDailyCcldTrId(deps.env, period));
  const query = {
    CANO: deps.accountNo8,
    ACNT_PRDT_CD: deps.accountProdCd,
    INQR_STRT_DT: yyyymmdd(params.from),
    INQR_END_DT: yyyymmdd(params.to),
    SLL_BUY_DVSN_CD: params.side === 'BUY' ? '02' : params.side === 'SELL' ? '01' : '00',
    PDNO: params.code ?? '',
    CCLD_DVSN: params.ccldDvsn ?? (params.filledOnly ? '01' : '00'),
    INQR_DVSN: '00',
    INQR_DVSN_3: '01',
    ORD_GNO_BRNO: '',
    ODNO: params.orderNo ?? '',
    INQR_DVSN_1: '',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
    EXCG_ID_DVSN_CD: params.exchange ?? 'KRX',
  };
  const res = await deps.http.get<unknown>(KIS_PATH.INQUIRE_CCNL, query, headers);
  if (res.isErr()) return err(res.error);
  const parsed = KisDailyCcldResponseSchema.safeParse(res.value.body);
  if (!parsed.success) {
    return err(
      makeKisError('VALIDATION', 'daily ccld response malformed', {
        cause: parsed.error.message,
      }),
    );
  }
  const bizErr = interpretRtCd(parsed.data.rt_cd, parsed.data.msg_cd, parsed.data.msg1);
  if (bizErr) return err(bizErr);

  return ok(
    parsed.data.output1.map((row) => ({
      odno: row.odno,
      ...(row.ord_orgno !== undefined && { orgNo: row.ord_orgno }),
      pdno: row.pdno,
      name: row.prdt_name?.trim() || row.pdno,
      side: row.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
      orderQty: parseNum(row.ord_qty),
      orderPrice: parseNum(row.ord_unpr),
      orderedAt: row.ord_tmd ?? '',
      totalFilledQty: parseNum(row.tot_ccld_qty),
      remainingQty: parseNum(row.rmn_qty),
      avgFillPrice: parseNum(row.avg_prvs),
      cancelled: row.cncl_yn === 'Y',
      rejectedQty: parseNum(row.rjct_qty),
    })),
  );
}

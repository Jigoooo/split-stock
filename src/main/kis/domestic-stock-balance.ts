import type { KisError } from '@shared/contracts';
import { KisBalanceResponseSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { authHeaders, type DomesticStockDeps, parseNum } from './domestic-stock-core';
import { KIS_PATH, trId } from './endpoints';
import { interpretRtCd, isRetryable, makeKisError } from './errors';

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
  deposit: number;
  d2Deposit: number;
  totalEval: number;
  estimatedAsset: number;
}

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
    d2Deposit: parseNum(summary?.prvs_rcdl_excc_amt),
    totalEval: parseNum(summary?.tot_evlu_amt),
    estimatedAsset: parseNum(summary?.nass_amt),
  });
}

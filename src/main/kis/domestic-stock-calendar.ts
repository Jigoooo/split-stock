import type { KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { authHeaders, type DomesticStockQueryDeps } from './domestic-stock-core';
import { KIS_PATH } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';

export interface DomesticHolidayInfo {
  date: string;
  weekdayCode: string;
  businessDay: boolean;
  tradingDay: boolean;
  openDay: boolean;
  settlementDay: boolean;
}

export async function inquireDomesticHoliday(
  deps: DomesticStockQueryDeps,
  bassDt: string,
): Promise<Result<DomesticHolidayInfo[], KisError>> {
  const headers = authHeaders(deps, 'CTCA0903R');
  const query = {
    BASS_DT: bassDt,
    CTX_AREA_FK: '',
    CTX_AREA_NK: '',
  };
  const res = await deps.http.get<unknown>(KIS_PATH.CHECK_HOLIDAY, query, headers);
  if (res.isErr()) return err(res.error);
  const body = res.value.body as {
    rt_cd?: string;
    msg_cd?: string;
    msg1?: string;
    output?: unknown;
  };
  if (typeof body.rt_cd !== 'string') {
    return err(makeKisError('VALIDATION', 'holiday response malformed', { cause: 'rt_cd 없음' }));
  }
  const bizErr = interpretRtCd(body.rt_cd, body.msg_cd ?? '', body.msg1 ?? '');
  if (bizErr) return err(bizErr);

  const output = Array.isArray(body.output) ? body.output : body.output ? [body.output] : [];
  return ok(
    output
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
      .map((row) => ({
        date: String(row.bass_dt ?? ''),
        weekdayCode: String(row.wday_dvsn_cd ?? ''),
        businessDay: row.bzdy_yn === 'Y',
        tradingDay: row.tr_day_yn === 'Y',
        openDay: row.opnd_yn === 'Y',
        settlementDay: row.sttl_day_yn === 'Y',
      }))
      .filter((row) => row.date.length > 0),
  );
}

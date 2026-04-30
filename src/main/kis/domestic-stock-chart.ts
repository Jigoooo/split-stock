import type { KisError } from '@shared/contracts';
import { KisDailyChartResponseSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import {
  authHeaders,
  type DomesticStockQueryDeps,
  parseNum,
  toIsoDate,
  yyyymmdd,
} from './domestic-stock-core';
import { KIS_PATH } from './endpoints';
import { interpretRtCd, makeKisError } from './errors';

export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ChartPeriod = 'D' | 'W' | 'M';

export async function inquireDailyChart(
  deps: DomesticStockQueryDeps,
  params: { code: string; from: Date; to: Date; period?: ChartPeriod },
): Promise<Result<DailyCandle[], KisError>> {
  const headers = authHeaders(deps, 'FHKST03010100');
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

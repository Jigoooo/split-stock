import type { Candle } from '@shared/contracts';

/**
 * Kiwoom 차트 응답 item — ka10081(일)/ka10082(주)/ka10083(월) 공통.
 * 검증: KiwoomRestApi.Net `KiwoomChartGetChartItem`.
 *
 * 모든 숫자 필드 string 응답. dt 형식: 'YYYYMMDD'.
 */
export interface KiwoomCandleItemWire {
  /** 일자 (YYYYMMDD). */
  dt?: string;
  /** 현재가 = 종가. */
  cur_prc?: string;
  /** 거래량. */
  trde_qty?: string;
  /** 시가. */
  open_pric?: string;
  /** 고가. */
  high_pric?: string;
  /** 저가. */
  low_pric?: string;
}

/** Wrapper — period 별로 키가 다름. */
export interface KiwoomDailyChartWire {
  return_code?: number | string;
  return_msg?: string;
  /** 일봉. */
  stk_dt_pole_chart_qry?: KiwoomCandleItemWire[];
  /** 주봉. */
  stk_stk_pole_chart_qry?: KiwoomCandleItemWire[];
  /** 월봉. */
  stk_mth_pole_chart_qry?: KiwoomCandleItemWire[];
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd ?? '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Kiwoom 차트 wire → 도메인 Candle[]. period 별 키 자동 선택.
 * 응답은 최신→과거 순이므로 마지막에 오래된 순으로 정렬.
 */
export function toKiwoomCandles(wire: KiwoomDailyChartWire, period: 'D' | 'W' | 'M'): Candle[] {
  const items =
    period === 'D'
      ? wire.stk_dt_pole_chart_qry
      : period === 'W'
        ? wire.stk_stk_pole_chart_qry
        : wire.stk_mth_pole_chart_qry;
  if (!items) return [];

  return items
    .map((row) => ({
      date: toIsoDate(row.dt ?? ''),
      open: parseNum(row.open_pric),
      high: parseNum(row.high_pric),
      low: parseNum(row.low_pric),
      close: parseNum(row.cur_prc),
      volume: parseNum(row.trde_qty),
    }))
    .filter((c) => c.close > 0 && c.date.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

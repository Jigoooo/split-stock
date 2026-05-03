import type { Quote } from '@shared/contracts';

/**
 * Kiwoom ka10006 (주식현재가) wire shape — cluefin schema 검증.
 * 모든 숫자 필드는 string 응답.
 */
export interface KiwoomQuoteWire {
  return_code?: number | string;
  return_msg?: string;
  date?: string;
  open_pric?: string;
  high_pric?: string;
  low_pric?: string;
  close_pric?: string;
  /** 전일대비 (양수/음수 부호). */
  pre?: string;
  /** 등락률 (%) */
  flu_rt?: string;
  /** 누적거래량 */
  trde_qty?: string;
  /** 누적거래대금 */
  trde_prica?: string;
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Kiwoom ka10006 wire → 도메인 Quote.
 *
 * Kiwoom 은 upperLimit/lowerLimit/prevClose 를 ka10006 응답에 포함하지 않음 —
 * 0 placeholder. 필요 시 ka10003 (상하한가) 별도 호출 또는 prev_close 보강.
 *
 * symbol 은 입력 인자로 받음 (Kiwoom 응답에 stk_cd 미포함).
 */
export function toKiwoomQuote(symbol: string, wire: KiwoomQuoteWire): Quote {
  const close = parseNum(wire.close_pric);
  return {
    symbol,
    price: close,
    dayChange: parseNum(wire.pre),
    dayChangeRate: parseNum(wire.flu_rt),
    accumVolume: parseNum(wire.trde_qty),
    accumValue: parseNum(wire.trde_prica),
    open: parseNum(wire.open_pric),
    high: parseNum(wire.high_pric),
    low: parseNum(wire.low_pric),
    upperLimit: 0,
    lowerLimit: 0,
    prevClose: close - parseNum(wire.pre),
  };
}

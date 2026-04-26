import type { OrderbookSnapshot } from '@shared/contracts';

/**
 * Kiwoom ka10004 (주식호가요청) wire shape — cluefin schema 검증.
 *
 * 매도 호가는 `sel{N}th_pre_bid`/`sel{N}th_pre_req` (N=2..10) +
 * `sel_fpr_bid`/`sel_fpr_req` (1호가 = first price). 매수도 동일 패턴.
 *
 * 모든 숫자 필드 string 응답.
 */
export interface KiwoomOrderbookWire {
  return_code?: number | string;
  return_msg?: string;
  /** 호가 시각 (HHMMSS). */
  bid_req_base_tm?: string;
  /** 매도 1호가. */
  sel_fpr_bid?: string;
  sel_fpr_req?: string;
  /** 매수 1호가. */
  buy_fpr_bid?: string;
  buy_fpr_req?: string;
  /** 매도/매수 2~10호가는 동적 키. */
  [key: string]: string | number | undefined;
  tot_sel_req?: string;
  tot_buy_req?: string;
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Kiwoom ka10004 wire → 도메인 OrderbookSnapshot.
 *
 * 10단계 호가 추출:
 *  - 매도1: sel_fpr_bid/req
 *  - 매도2~10: sel{2..10}th_pre_bid/req
 *  - 매수1: buy_fpr_bid/req
 *  - 매수2~10: buy{2..10}th_pre_bid/req
 *
 * expectedPrice/expectedQty 는 ka10004 가 별도 제공 — Stage 6.5 라이브 검증
 * 후 필드명 보정 가능. 현재 0 placeholder.
 */
export function toKiwoomOrderbook(symbol: string, wire: KiwoomOrderbookWire): OrderbookSnapshot {
  const asks: Array<{ price: number; qty: number }> = [];
  const bids: Array<{ price: number; qty: number }> = [];

  // 매도 1호가
  asks.push({
    price: parseNum(wire.sel_fpr_bid),
    qty: parseNum(wire.sel_fpr_req),
  });
  // 매도 2~10호가
  for (let n = 2; n <= 10; n++) {
    asks.push({
      price: parseNum(wire[`sel${n}th_pre_bid`] as string | undefined),
      qty: parseNum(wire[`sel${n}th_pre_req`] as string | undefined),
    });
  }

  // 매수 1호가
  bids.push({
    price: parseNum(wire.buy_fpr_bid),
    qty: parseNum(wire.buy_fpr_req),
  });
  // 매수 2~10호가
  for (let n = 2; n <= 10; n++) {
    bids.push({
      price: parseNum(wire[`buy${n}th_pre_bid`] as string | undefined),
      qty: parseNum(wire[`buy${n}th_pre_req`] as string | undefined),
    });
  }

  return {
    symbol,
    time: wire.bid_req_base_tm ?? '',
    asks,
    bids,
    totalAskQty: parseNum(wire.tot_sel_req),
    totalBidQty: parseNum(wire.tot_buy_req),
    expectedPrice: 0,
    expectedQty: 0,
  };
}

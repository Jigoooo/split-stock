import type { DailyExecution, OrderSide } from '@shared/contracts';

/**
 * Kiwoom ka10075(미체결) item wire — cluefin `unexecutedItemSchema` 검증.
 */
export interface KiwoomUnexecutedItemWire {
  ord_no?: string;
  stk_cd?: string;
  stk_nm?: string;
  ord_qty?: string;
  ord_pric?: string;
  /** 미체결수량. */
  oso_qty?: string;
  /** 체결수량. */
  cntr_qty?: string;
  /** 체결가. */
  cntr_pric?: string;
  /** 매매구분명 (매수/매도/취소 등). */
  io_tp_nm?: string;
  /** 주문상태 (정상/취소 등). */
  ord_stt?: string;
  /** 주문시각. ka10075 는 `tm`, ka10076 는 `ord_tm`. */
  tm?: string;
  ord_tm?: string;
}

/**
 * ka10076 (체결) item wire — cluefin `executedItemSchema` 검증.
 * ka10075 와 거의 동일 필드 (시각 키 차이만).
 */
export interface KiwoomExecutedItemWire extends KiwoomUnexecutedItemWire {}

export interface KiwoomUnexecutedResponseWire {
  return_code?: number | string;
  return_msg?: string;
  oso?: KiwoomUnexecutedItemWire[];
}

export interface KiwoomExecutedResponseWire {
  return_code?: number | string;
  return_msg?: string;
  cntr?: KiwoomExecutedItemWire[];
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

function inferSide(io_tp_nm: string | undefined): OrderSide {
  // io_tp_nm 예: '매수', '매도', '매수취소', '매도정정' 등 — '매수' 포함하면 BUY
  if (io_tp_nm && /매수/.test(io_tp_nm)) return 'BUY';
  return 'SELL';
}

function inferCancelled(ord_stt: string | undefined, io_tp_nm: string | undefined): boolean {
  return !!((ord_stt && /취소/.test(ord_stt)) || (io_tp_nm && /취소/.test(io_tp_nm)));
}

export function toKiwoomDailyExecution(
  item: KiwoomUnexecutedItemWire | KiwoomExecutedItemWire,
): DailyExecution {
  const orderQty = parseNum(item.ord_qty);
  const totalFilledQty = parseNum(item.cntr_qty);
  const remainingQty = parseNum(item.oso_qty) || Math.max(0, orderQty - totalFilledQty);
  const cancelled = inferCancelled(item.ord_stt, item.io_tp_nm);
  return {
    brokerOrderId: item.ord_no ?? '',
    symbol: item.stk_cd ?? '',
    name: item.stk_nm?.trim() || (item.stk_cd ?? ''),
    side: inferSide(item.io_tp_nm),
    orderQty,
    orderPrice: parseNum(item.ord_pric),
    orderedAt: item.ord_tm ?? item.tm ?? '',
    totalFilledQty,
    remainingQty,
    avgFillPrice: parseNum(item.cntr_pric),
    cancelled,
    rejectedQty: 0,
  };
}

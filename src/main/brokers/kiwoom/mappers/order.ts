import type { OrderAck, OrderAmendIntent, OrderIntent } from '@shared/contracts';
import type { CancelOrderInput } from '../../ports';
import { KIWOOM_EXCHANGE, KIWOOM_ORDER_TYPE } from '../metadata/endpoints';

/** Kiwoom 주문 응답 wire shape — kt10000~3 공통 필드. */
export interface KiwoomOrderResponseWire {
  return_code?: number | string;
  return_msg?: string;
  /** 주문번호. */
  ord_no?: string;
  /** 거래소 구분. */
  dmst_stex_tp?: string;
}

/**
 * 도메인 OrderIntent → Kiwoom kt10000(BUY)/kt10001(SELL) body.
 *
 * - clientOrderId 는 Kiwoom idempotency 미지원 → drop
 * - kind LIMIT → trde_tp '0' (보통), MARKET → '3' (시장가, ord_uv 빈 문자)
 * - dmst_stex_tp: 기본 '1' (KRX). NXT/SOR 라우팅은 호출측에서 별도 옵션
 */
export function toKiwoomPlaceOrderBody(
  intent: OrderIntent,
  defaultExchange: '1' | '2' | '3' = KIWOOM_EXCHANGE.KRX,
): Record<string, string> {
  const isMarket = intent.kind === 'MARKET';
  return {
    dmst_stex_tp: defaultExchange,
    stk_cd: intent.symbol,
    ord_qty: String(intent.qty),
    trde_tp: isMarket ? KIWOOM_ORDER_TYPE.MARKET : KIWOOM_ORDER_TYPE.LIMIT,
    ord_uv: isMarket ? '' : String(intent.price),
  };
}

/**
 * 도메인 OrderAmendIntent → Kiwoom kt10002 (정정) body.
 * 정정은 qty/price 모두 필요. all 옵션은 무시 (Kiwoom 정정에서는 의미 없음).
 */
export function toKiwoomModifyOrderBody(
  amend: OrderAmendIntent,
  defaultExchange: '1' | '2' | '3' = KIWOOM_EXCHANGE.KRX,
): Record<string, string> {
  return {
    dmst_stex_tp: defaultExchange,
    orig_ord_no: amend.brokerOrderId,
    // Kiwoom kt10002 는 stk_cd 필수. 호출측이 symbol 을 같이 전달.
    stk_cd: amend.symbol ?? '',
    mdfy_qty: String(amend.qty ?? 0),
    mdfy_uv: String(amend.price ?? 0),
  };
}

/**
 * 도메인 CancelOrderInput → Kiwoom kt10003 (취소) body.
 * cncl_qty='0' = 전량 취소 (Kiwoom 명세). all=true 또는 qtyAllOrder=true 처리.
 */
export function toKiwoomCancelOrderBody(
  input: CancelOrderInput,
  defaultExchange: '1' | '2' | '3' = KIWOOM_EXCHANGE.KRX,
): Record<string, string> {
  const isAll = input.all === true || input.qtyAllOrder === true;
  return {
    dmst_stex_tp: defaultExchange,
    orig_ord_no: input.brokerOrderId,
    // Kiwoom kt10003 는 stk_cd 필수. 호출측이 symbol 을 같이 전달.
    stk_cd: input.symbol ?? '',
    cncl_qty: isAll ? '0' : String(input.qty ?? 0),
  };
}

/**
 * Kiwoom 주문 응답 → 도메인 OrderAck.
 *
 * Kiwoom 의 ord_no 는 항상 string. brokerOrgNo / acceptedAt 은 응답에 없으므로
 * 키 자체 생략 (exactOptionalPropertyTypes 호환).
 */
export function toOrderAck(wire: KiwoomOrderResponseWire): OrderAck {
  return {
    brokerOrderId: wire.ord_no ?? '',
  };
}

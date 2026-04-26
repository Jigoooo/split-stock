import type { OrderAmendParams, OrderCashParams } from '@main/kis/order';
import type {
  NormalizedOrderAck,
  OrderAck,
  OrderAmendIntent,
  OrderIntent,
} from '@shared/contracts';
import type { CancelOrderInput } from '../../ports/order-port';

/**
 * 도메인 OrderIntent → KIS OrderCashParams.
 *
 * - symbol → pdno
 * - kind   → division
 * - clientOrderId 는 KIS 가 idempotency key 미지원이라 무시 (drop)
 */
export function toKisOrderCashParams(intent: OrderIntent): OrderCashParams {
  return {
    side: intent.side,
    pdno: intent.symbol,
    qty: intent.qty,
    price: intent.price,
    division: intent.kind,
  };
}

/**
 * 도메인 amend → KIS cancel/revise params.
 *
 * cancelOrder / amendOrder 의 공용 매퍼. action 분기는 호출측 (adapter) 책임.
 */
export function toKisAmendParams(
  amend: OrderAmendIntent,
  action: 'cancel' | 'revise',
): OrderAmendParams {
  return {
    action,
    orgOrgNo: amend.brokerOrgNo ?? '',
    orgOdno: amend.brokerOrderId,
    division: amend.kind ?? 'LIMIT',
    qty: amend.qty ?? 0,
    price: amend.price ?? 0,
    qtyAllOrder: amend.qtyAllOrder ?? false,
  };
}

/**
 * 취소 input (qtyAllOrder 또는 all) 처리.
 * all=true 면 qtyAllOrder=true 로 강제 — KIS 의 QTY_ALL_ORD_YN='Y' 매핑.
 */
export function toKisCancelParams(input: CancelOrderInput): OrderAmendParams {
  return toKisAmendParams(
    {
      ...input,
      qtyAllOrder: input.all ? true : (input.qtyAllOrder ?? false),
    },
    'cancel',
  );
}

/**
 * KIS NormalizedOrderAck → 도메인 OrderAck.
 *
 * 필드명 매핑:
 *  odno      → brokerOrderId
 *  orgNo     → brokerOrgNo
 *  orderedAt → acceptedAt
 */
export function toOrderAck(ack: NormalizedOrderAck): OrderAck {
  return {
    brokerOrderId: ack.odno,
    ...(ack.orgNo !== undefined && { brokerOrgNo: ack.orgNo }),
    ...(ack.orderedAt !== undefined && { acceptedAt: ack.orderedAt }),
  };
}

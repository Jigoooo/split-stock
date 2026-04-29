import type { DailyCcldOrder } from '@main/kis/domestic-stock';
import type { DailyExecution } from '@shared/contracts';

/**
 * KIS DailyCcldOrder → broker-agnostic DailyExecution.
 *
 * 필드 매핑:
 *  odno → brokerOrderId
 *  orgNo → brokerOrgNo
 *  pdno → symbol
 *  나머지 (side / orderQty / orderPrice / orderedAt / totalFilledQty / remainingQty /
 *  avgFillPrice / cancelled / rejectedQty) 는 도메인과 동일 형태.
 */
export function toDailyExecution(o: DailyCcldOrder): DailyExecution {
  return {
    brokerOrderId: o.odno,
    ...(o.orgNo !== undefined && { brokerOrgNo: o.orgNo }),
    symbol: o.pdno,
    name: o.name,
    side: o.side,
    orderQty: o.orderQty,
    orderPrice: o.orderPrice,
    orderedAt: o.orderedAt,
    totalFilledQty: o.totalFilledQty,
    remainingQty: o.remainingQty,
    avgFillPrice: o.avgFillPrice,
    cancelled: o.cancelled,
    rejectedQty: o.rejectedQty,
  };
}

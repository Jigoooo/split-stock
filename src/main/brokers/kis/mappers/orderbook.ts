import type { OrderbookSnapshot as KisOrderbookSnapshot } from '@main/kis/domestic-stock';
import type { OrderbookSnapshot } from '@shared/contracts';

/**
 * KIS OrderbookSnapshot → broker-agnostic OrderbookSnapshot.
 *
 * KIS 의 OrderbookLevel.quantity 와 도메인의 OrderbookLevel.qty 필드명만 다르고
 * 그 외 구조는 동일.
 */
export function toOrderbookSnapshot(o: KisOrderbookSnapshot): OrderbookSnapshot {
  return {
    symbol: o.pdno,
    time: o.time,
    asks: o.asks.map((a) => ({ price: a.price, qty: a.quantity })),
    bids: o.bids.map((b) => ({ price: b.price, qty: b.quantity })),
    totalAskQty: o.totalAskQty,
    totalBidQty: o.totalBidQty,
    expectedPrice: o.expectedPrice,
    expectedQty: o.expectedQty,
  };
}

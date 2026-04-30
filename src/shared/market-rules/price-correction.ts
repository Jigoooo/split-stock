/**
 * 지정가 주문 호가 자동 보정 (Price Correction).
 *
 * 박스권 분할매매 ASIS: 통합환경설정 → 주문설정 → 지정가 주문 (호가 자동 보정).
 * 계산된 목표가(next_buy_price, sell_target 등)가 호가단위와 맞지 않을 경우
 * 매수/매도 방향 + 전략(AGGRESSIVE/CONSERVATIVE)에 따라 가장 가까운 호가로 보정.
 *
 * 전략 의미:
 *   AGGRESSIVE 매수  → 올림 (매도호가 측) — 즉시 체결 가능성 높음, 약간 비쌈
 *   CONSERVATIVE 매수 → 내림 (매수호가 측) — 대기 (저렴하지만 미체결 위험)
 *   AGGRESSIVE 매도  → 내림 (매수호가 측) — 즉시 체결 가능성 높음, 약간 저렴
 *   CONSERVATIVE 매도 → 올림 (매도호가 측) — 대기 (비싸지만 미체결 위험)
 *
 * orderbook 제공 시: best-ask / best-bid 가격으로 snap (orderbook 우선).
 * orderbook 미제공 시: tick 방향만으로 올림/내림.
 *
 * 이미 tick 단위에 맞아 있으면 보정 없이 그대로 반환 (no-op).
 *
 * Broker-agnostic: KRX 거래소 규칙 + 전략 로직이므로 KIS/Kiwoom 모두 동일하게 사용.
 */

import { isOnTick, roundToTick } from './price-tick';

export type CorrectionSide = 'BUY' | 'SELL';
export type CorrectionStrategy = 'AGGRESSIVE' | 'CONSERVATIVE';

export interface OrderbookInput {
  /** 매도 1~N호가 (낮은 가격 우선). 최소 asks[0] 이 있으면 사용. */
  asks: { price: number }[];
  /** 매수 1~N호가 (높은 가격 우선). 최소 bids[0] 이 있으면 사용. */
  bids: { price: number }[];
}

export interface CorrectLimitPriceParams {
  /** 보정 전 목표 가격 */
  targetPrice: number;
  /** 매수 or 매도 */
  side: CorrectionSide;
  /** AGGRESSIVE = 즉시체결 우선, CONSERVATIVE = 지연·유리가 우선 */
  strategy: CorrectionStrategy;
  /** 호가창 스냅샷 — 없으면 tick 방향만으로 처리 */
  orderbook?: OrderbookInput;
}

/**
 * 지정가 주문가를 호가단위에 맞게 자동 보정하여 반환한다.
 *
 * 보정 규칙:
 * 1. targetPrice 가 0 이하이면 그대로 반환 (시장가 등 비정상값 통과).
 * 2. targetPrice 가 이미 tick 단위에 맞으면 그대로 반환.
 * 3. orderbook 이 있고 bestAsk/bestBid 가 유효하면:
 *    - AGGRESSIVE 매수  → bestAsk (매도1호가), CONSERVATIVE 매수  → bestBid (매수1호가)
 *    - AGGRESSIVE 매도  → bestBid (매수1호가), CONSERVATIVE 매도  → bestAsk (매도1호가)
 * 4. orderbook 없음 또는 호가 정보 무효 → tick 올림/내림:
 *    - AGGRESSIVE 매수  → 올림 (ceil)
 *    - CONSERVATIVE 매수 → 내림 (floor)
 *    - AGGRESSIVE 매도  → 내림 (floor)
 *    - CONSERVATIVE 매도 → 올림 (ceil)
 */
export function correctLimitPrice(params: CorrectLimitPriceParams): number {
  const { targetPrice, side, strategy, orderbook } = params;

  if (targetPrice <= 0) return targetPrice;
  if (isOnTick(targetPrice)) return targetPrice;

  // orderbook snap (우선 시도)
  if (orderbook) {
    const bestAsk = orderbook.asks[0]?.price ?? 0;
    const bestBid = orderbook.bids[0]?.price ?? 0;

    const useAsk = side === 'BUY' ? strategy === 'AGGRESSIVE' : strategy === 'CONSERVATIVE';
    const snapPrice = useAsk ? bestAsk : bestBid;

    if (snapPrice > 0 && isOnTick(snapPrice)) {
      return snapPrice;
    }
    // snapPrice 가 유효하지 않으면 tick 방향 fallback
  }

  // tick 방향 보정
  const roundUp =
    (side === 'BUY' && strategy === 'AGGRESSIVE') ||
    (side === 'SELL' && strategy === 'CONSERVATIVE');

  return roundToTick(targetPrice, roundUp);
}

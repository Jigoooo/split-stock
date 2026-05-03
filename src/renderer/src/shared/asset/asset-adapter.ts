/**
 * 자산 클래스(국내주식·코인 등) 차이를 흡수하는 broker-agnostic 어댑터.
 *
 * 같은 매직스플릿 도메인을 사용하면서도 KIS/UPBIT 등 자산 클래스마다
 * 가격 포맷·호가 단위·주문 타입 코드가 다르다. 위젯(PriceChips, OrderTicket,
 * StageRulesEditor)은 어댑터를 주입받아 자산 클래스를 모르고 동작한다.
 *
 * Hook은 인터페이스에 포함하지 않는다 — FSD 레이어 위반(shared가 widgets를
 * 참조)을 피하기 위해 호출자가 직접 hook을 호출하고 결과를 컴포넌트에
 * 전달한다. (RALPLAN P1)
 */

export type AssetKind = 'stock' | 'crypto';

export type OrderSide = 'buy' | 'sell';

export interface PriceSnapshot {
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  dayChange: number | null;
  dayChangeRate: number | null;
  upperLimit: number | null;
  lowerLimit: number | null;
  /** 24시간 누적 거래대금 (코인은 acc_trade_price_24h, 주식은 acml_tr_pbmn 매핑) */
  accTradeAmount: number | null;
}

export interface OrderableSnapshot {
  /** 매수 가능 수량 (=가능 현금 / 가격, floor) */
  availableQty: number;
  /** 매수 가능 현금 — KRW 정수 또는 소수 */
  availableCash: number;
}

export interface AssetAdapter {
  readonly kind: AssetKind;
  /** KIS pdno 또는 UPBIT market (KRW-BTC) */
  readonly symbol: string;
  /** 'KRW' | 'BTC' | 'USDT' 등 */
  readonly quoteCurrency: string;
  /** 가격 포맷 — 호가 단위 반영 */
  formatPrice(value: number | string | null | undefined): string;
  /** 수량 포맷 */
  formatVolume(value: number | string | null | undefined): string;
  /** 주문 금액 포맷 */
  formatAmount(value: number | string | null | undefined): string;
  /** 호가 단위 — stock은 가격대 의존, crypto는 instance 저장 */
  tickSize(price: number): number;
  /** 주문 타입 매핑 — broker별 코드 차이 흡수 */
  readonly orderTypeMap: {
    readonly limit: string;
    readonly market: string;
  };
  /** 시장가 주문 코드를 매수/매도 side에 따라 분기 (UPBIT: 매수=price, 매도=market) */
  resolveMarketOrderType(side: OrderSide): string;
}

import type {
  BrokerError,
  DailyExecution,
  OrderAck,
  OrderAmendIntent,
  OrderIntent,
  OrderSide,
  StockSymbol,
} from '@shared/contracts';
import type { Result } from '../core/result';

export interface CancelOrderInput extends OrderAmendIntent {
  /** 전량 취소 (qty 무시). KIS qtyAllOrder, Kiwoom cncl_qty='0' 매핑. */
  all?: boolean;
}

export interface ListDailyExecutionsParams {
  from: Date;
  to: Date;
  /** 특정 주문번호로 필터. */
  brokerOrderId?: string;
  /** 특정 종목으로 필터. */
  symbol?: StockSymbol;
  /** 매수/매도 필터. ALL = 전체. */
  side?: 'ALL' | OrderSide;
  /** 체결만 (true) / 미체결 포함 (false) — broker별 mapper 가 분기. */
  filledOnly?: boolean;
}

/**
 * 주문 port — 매수/매도/정정/취소/일별조회.
 */
export interface OrderPort {
  placeOrder(intent: OrderIntent): Promise<Result<OrderAck, BrokerError>>;
  cancelOrder(input: CancelOrderInput): Promise<Result<OrderAck, BrokerError>>;
  amendOrder(input: OrderAmendIntent): Promise<Result<OrderAck, BrokerError>>;

  /**
   * 일별 주문/체결 조회 (manual reconciler 용).
   * KIS inquireDailyCcld + tr_cont 페이지네이션 / Kiwoom ka10075|ka10076 + cont-yn 모두 흡수.
   */
  listDailyExecutions(
    params: ListDailyExecutionsParams,
  ): Promise<Result<DailyExecution[], BrokerError>>;
}

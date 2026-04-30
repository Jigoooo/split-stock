import type {
  BrokerError,
  Candle,
  OrderbookSnapshot,
  Quote,
  StockSymbol,
  TradingDayVerdict,
} from '@shared/contracts';
import type { Result } from '../core/result';

export interface GetDailyOhlcvParams {
  symbol: StockSymbol;
  from: Date;
  to: Date;
  /** 'D' 일봉 (기본), 'W' 주봉, 'M' 월봉. */
  period?: 'D' | 'W' | 'M';
}

/**
 * 시세 port — 현재가/호가/일봉/거래일 판정.
 *
 * 거래일 판정:
 *  - KIS/Kiwoom 모두 TradingCalendarService 의 공통 KRX verdict 를 최종 기준으로 사용
 *  - KIS chk-holiday 는 검증/로그 보조 신호로만 사용
 */
export interface MarketPort {
  getQuote(symbol: StockSymbol): Promise<Result<Quote, BrokerError>>;
  getOrderbook(symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>>;
  getDailyOhlcv(params: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>>;
  getTradingDayStatus(date: Date): Promise<Result<TradingDayVerdict, BrokerError>>;
  isTradingDay(date: Date): Promise<Result<boolean, BrokerError>>;
}

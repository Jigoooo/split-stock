import type { BrokerError, Candle, OrderbookSnapshot, Quote, StockSymbol } from '@shared/contracts';
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
 *  - KIS 는 inquireDomesticHoliday 로 broker-specific 응답
 *  - Kiwoom 은 휴장일 endpoint 미제공 → adapter 가 shared/market-rules/krx-holidays.ts
 *    (Stage 6 추가) 캐시로 broker-agnostic 폴백
 *  - 둘 다 같은 결과 (boolean) 반환
 */
export interface MarketPort {
  getQuote(symbol: StockSymbol): Promise<Result<Quote, BrokerError>>;
  getOrderbook(symbol: StockSymbol): Promise<Result<OrderbookSnapshot, BrokerError>>;
  getDailyOhlcv(params: GetDailyOhlcvParams): Promise<Result<Candle[], BrokerError>>;
  isTradingDay(date: Date): Promise<Result<boolean, BrokerError>>;
}

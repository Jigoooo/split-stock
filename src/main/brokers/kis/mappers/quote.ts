import type { QuoteResult } from '@main/kis/domestic-stock';
import type { Quote } from '@shared/contracts';

/**
 * KIS QuoteResult → broker-agnostic Quote.
 *
 * 필드명 매핑: code → symbol. 나머지 가격/거래량 필드는 동일 형태.
 */
export function toQuote(q: QuoteResult): Quote {
  return {
    symbol: q.code,
    price: q.price,
    dayChange: q.dayChange,
    dayChangeRate: q.dayChangeRate,
    accumVolume: q.accumVolume,
    accumValue: q.accumValue,
    open: q.open,
    high: q.high,
    low: q.low,
    upperLimit: q.upperLimit,
    lowerLimit: q.lowerLimit,
    prevClose: q.prevClose,
  };
}

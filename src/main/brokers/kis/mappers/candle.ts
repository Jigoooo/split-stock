import type { DailyCandle } from '@main/kis/domestic-stock';
import type { Candle } from '@shared/contracts';

/**
 * KIS DailyCandle → broker-agnostic Candle.
 *
 * 필드 구조 동일. KIS 는 date 가 ISO "YYYY-MM-DD" — 도메인 schema 도 string 이므로 그대로 유지.
 * (Kiwoom 도 mapper 에서 같은 ISO 형태로 정규화하면 broker-agnostic.)
 */
export function toCandle(c: DailyCandle): Candle {
  return {
    date: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  };
}

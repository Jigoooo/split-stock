/**
 * KRX broker-agnostic 거래소 규칙 모듈.
 *
 * 거래소(KRX) 차원의 규칙은 broker(KIS/Kiwoom)와 무관하므로 shared 에 위치.
 * - 호가 단위 (tick size)
 * - 지정가 주문 자동 보정 (price correction)
 *
 * 향후 확장: 휴장일 캐시, 거래시간 규칙, 거래대금 규제 등.
 */

export {
  BUNDLED_KRX_CALENDAR_SOURCE_VERSION,
  BUNDLED_KRX_CALENDAR_YEARS,
  type BundledKrxCalendarDay,
  isKrxTradingDay,
  KRX_REGULAR_CLOSE_MINUTE,
  KRX_REGULAR_OPEN_MINUTE,
  listBundledKrxCalendarDays,
  resolveBundledKrxTradingDay,
} from './krx-trading-day';
export {
  type CorrectionSide,
  type CorrectionStrategy,
  type CorrectLimitPriceParams,
  correctLimitPrice,
  type OrderbookInput,
} from './price-correction';
export { getTickSize, isOnTick, roundToTick } from './price-tick';

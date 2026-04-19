/**
 * KRX 주식시장 가격대별 호가단위 (tick size) 헬퍼.
 *
 * 기준: 한국거래소(KRX) 유가증권/코스닥 주식 호가단위 2023-01-02 개정 시행.
 * 출처: KRX 업무규정 제60조 / KIS Developers API 문서 "주식현재가 호가" 참고.
 *
 * 개정 후 가격대-호가단위 테이블 (유가증권·코스닥 동일):
 *   2,000원 미만        →   5원
 *   2,000 ~ 5,000원 미만  →  10원
 *   5,000 ~ 20,000원 미만 →  50원
 *  20,000 ~ 50,000원 미만 → 100원
 *  50,000 ~200,000원 미만 → 500원
 * 200,000원 이상         → 1,000원
 *
 * NOTE: ETF/ETN 은 별도 규정이지만 매직스플릿은 개별 주식만 취급하므로 위 테이블을 사용.
 */

/**
 * 주어진 가격에 해당하는 KRX 호가단위를 반환한다.
 * price 가 0 이하이면 5를 반환 (최소단위 — 오류 guard).
 */
export function getTickSize(price: number): number {
  if (price < 2_000) return 5;
  if (price < 5_000) return 10;
  if (price < 20_000) return 50;
  if (price < 50_000) return 100;
  if (price < 200_000) return 500;
  return 1_000;
}

/**
 * price 가 이미 tick 단위에 맞는지 확인한다.
 */
export function isOnTick(price: number): boolean {
  return price % getTickSize(price) === 0;
}

/**
 * price 를 가장 가까운 tick 으로 올림 또는 내림한다.
 *
 * @param price   보정할 목표 가격
 * @param roundUp true → 올림 (ceil), false → 내림 (floor)
 *
 * 이미 tick 에 맞아 있으면 그대로 반환.
 * 결과가 1 미만이 되지 않도록 최소 tickSize 를 보장한다.
 */
export function roundToTick(price: number, roundUp: boolean): number {
  if (price <= 0) return 0;
  const tick = getTickSize(price);
  if (price % tick === 0) return price;
  const floored = Math.floor(price / tick) * tick;
  const ceiled = floored + tick;
  const result = roundUp ? ceiled : floored;
  return Math.max(result, tick);
}

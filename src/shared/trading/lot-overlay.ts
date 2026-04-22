/**
 * 차수 장부를 차트 오버레이 라인으로 변환하는 순수 함수 (cross-process safe).
 * 동일 타입 정의가 main/trading/fsm.ts의 LotSnapshot과 호환되어야 한다.
 */

export type LotOverlayStatus = 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING';

export interface LotOverlaySnapshot {
  nth: number;
  buyPrice: number;
  qty: number;
  status: LotOverlayStatus;
}

export interface LotOverlayLine {
  kind: 'buy' | 'sell-target';
  nth: number;
  price: number;
  label: string;
}

export interface LotOverlayConfig {
  profitPct: number;
  /** SOLD 차수도 회색 buy 라인으로 남길지 여부 (기본 false — OPEN만). */
  includeSold?: boolean;
}

/**
 * - OPEN 차수: buy 라인 + sell-target 라인(익절선 = buyPrice*(1+profitPct)) 2개
 * - SOLD 차수: includeSold=true일 때만 buy 라인(청산 표시)
 * - BUYING/SELLING: 라인 미생성 (pending 상태 UI 노이즈 방지)
 * - 반환 배열은 가격 오름차순 정렬.
 */
export function buildLotOverlay(
  lots: LotOverlaySnapshot[],
  config: LotOverlayConfig,
): LotOverlayLine[] {
  const lines: LotOverlayLine[] = [];
  for (const lot of lots) {
    const roundedBuyPrice = Math.round(lot.buyPrice);
    if (lot.status === 'OPEN') {
      lines.push({
        kind: 'buy',
        nth: lot.nth,
        price: roundedBuyPrice,
        label: `${lot.nth}차 매수 ${roundedBuyPrice.toLocaleString('ko-KR')}`,
      });
      const target = Math.round(lot.buyPrice * (1 + config.profitPct));
      lines.push({
        kind: 'sell-target',
        nth: lot.nth,
        price: target,
        label: `${lot.nth}차 익절선 ${target.toLocaleString('ko-KR')}`,
      });
    } else if (lot.status === 'SOLD' && config.includeSold) {
      lines.push({
        kind: 'buy',
        nth: lot.nth,
        price: roundedBuyPrice,
        label: `${lot.nth}차 매수(청산) ${roundedBuyPrice.toLocaleString('ko-KR')}`,
      });
    }
  }
  return lines.sort((a, b) => a.price - b.price);
}

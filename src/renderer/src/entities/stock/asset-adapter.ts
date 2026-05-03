import type { AssetAdapter, OrderSide } from '@renderer/shared/asset/asset-adapter';
import { getTickSize } from '@shared/market-rules/price-tick';

const KRW_FORMATTER = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

const formatKrw = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return KRW_FORMATTER.format(numeric);
};

/**
 * 국내주식(KIS) 자산 클래스 어댑터.
 *
 * - 가격·수량·금액 모두 KRW 정수 포맷 (Intl ko-KR)
 * - 호가 단위는 KRX 2023.01.25 개정 기준 가격대별 함수
 * - 주문 타입: KIS ORD_DVSN 코드 (00 지정가, 01 시장가) — 매수/매도 동일
 */
export const createStockAdapter = (pdno: string): AssetAdapter => ({
  kind: 'stock',
  symbol: pdno,
  quoteCurrency: 'KRW',
  formatPrice: formatKrw,
  formatVolume: formatKrw,
  formatAmount: formatKrw,
  tickSize: (price) => getTickSize(price),
  orderTypeMap: {
    limit: '00',
    market: '01',
  },
  resolveMarketOrderType: (_side: OrderSide) => '01',
});

import {
  formatCryptoAmount,
  formatCryptoPrice,
  formatCryptoVolume,
  getCryptoQuote,
} from '@renderer/pages/main/model/crypto-format';
import type { AssetAdapter, OrderSide } from '@renderer/shared/asset/asset-adapter';

/**
 * 코인(UPBIT) 자산 클래스 어댑터.
 *
 * - 가격: KRW 마켓은 정수, BTC/USDT는 소수 (crypto-format 위임)
 * - 수량: 8자리 소수
 * - 호가 단위: UPBIT는 마켓별 동적 값 — `getOrderbookInstruments` trpc 결과에서
 *   추출해 어댑터 생성 시 주입. price 인자는 무시한다.
 * - 주문 타입 비대칭: UPBIT는 매수 시장가가 `price`(KRW 금액 지정),
 *   매도 시장가가 `market`(수량 지정)으로 분기된다.
 */
export const createCryptoAdapter = (
  market: string,
  options: { tickSize?: number } = {},
): AssetAdapter => {
  const fixedTickSize = options.tickSize ?? 1;
  return {
    kind: 'crypto',
    symbol: market,
    quoteCurrency: getCryptoQuote(market),
    formatPrice: (value) => formatCryptoPrice(value ?? undefined, market),
    formatVolume: (value) => formatCryptoVolume(value ?? undefined),
    formatAmount: (value) => formatCryptoAmount(value ?? undefined, market),
    tickSize: (_price) => fixedTickSize,
    orderTypeMap: {
      limit: 'limit',
      market: 'market',
    },
    resolveMarketOrderType: (side: OrderSide) => (side === 'buy' ? 'price' : 'market'),
  };
};

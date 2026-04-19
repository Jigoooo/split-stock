import type { FeeEnv } from '../db/settings-repo';

export type TradeSide = 'buy' | 'sell';

/**
 * 수수료 및 제세금 적용 결과
 */
export interface FeeApplied {
  fee: number;
  tax: number;
  netAmount: number;
}

/**
 * 거래액에 수수료 및 제세금 적용.
 *
 * @param env 환경 ('real'|'mock')
 * @param side 거래 방향 ('buy'|'sell')
 * @param amount 거래액
 * @param fees 수수료 설정 { buy, sell, tax }
 * @returns { fee, tax, netAmount }
 *
 * 계산 로직:
 * - buy: amount - (amount * buy_rate) - (amount * tax_rate)
 * - sell: amount - (amount * sell_rate) (세금 미포함)
 */
export function applyFees(
  _env: FeeEnv,
  side: TradeSide,
  amount: number,
  fees: { buy: number; sell: number; tax: number },
): FeeApplied {
  const feeRate = side === 'buy' ? fees.buy : fees.sell;
  const fee = amount * feeRate;

  // 매도 시 제세금 미적용 (매수 시에만)
  const tax = side === 'buy' ? amount * fees.tax : 0;

  const netAmount = amount - fee - tax;

  return { fee, tax, netAmount };
}

import type { BalanceResult, Position } from '@main/kis/domestic-stock';
import type { Balance, Holding } from '@shared/contracts';

/**
 * KIS Position 응답을 broker-agnostic Holding 도메인 모델로 변환.
 */
export function toHolding(p: Position): Holding {
  return {
    symbol: p.code,
    name: p.name,
    qty: p.qty,
    avgPrice: p.avgPrice,
    currentPrice: p.currentPrice,
    evalAmount: p.evalAmount,
    pnlAmount: p.pnlAmount,
    pnlRate: p.pnlRate,
  };
}

/**
 * KIS BalanceResult 를 broker-agnostic Balance 로 변환.
 */
export function toBalance(b: BalanceResult): Balance {
  return {
    positions: b.positions.map(toHolding),
    deposit: b.deposit,
    d2Deposit: b.d2Deposit,
    totalEval: b.totalEval,
    estimatedAsset: b.estimatedAsset,
  };
}

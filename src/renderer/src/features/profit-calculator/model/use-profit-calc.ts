/**
 * 수익률 계산 로직
 * - 탭 1: 매수금액 + 수익률 → 결과액 계산
 * - 탭 2: 매수금액 + 매도금액 → 수익률 계산
 */

export interface ProfitCalcInput {
  buyAmount: number;
  profitRate: number;
  buyFeeRate: number;
  sellFeeRate: number;
  taxRate: number;
  includeFees: boolean;
}

export interface ProfitCalcResult {
  resultAmount: number;
  buyFee: number;
  netBuyAmount: number;
}

export interface ProfitRateInput {
  buyAmount: number;
  sellAmount: number;
  buyFeeRate: number;
  sellFeeRate: number;
  taxRate: number;
  includeFees: boolean;
}

export interface ProfitRateResult {
  profitRate: number;
  profit: number;
  buyFee: number;
  sellFee: number;
  tax: number;
  netProfit: number;
  netBuyAmount: number;
  netSellAmount: number;
}

/**
 * 탭 1: 매수금액 + 수익률 → 결과액 계산
 */
export function calculateProfitAmount(input: ProfitCalcInput): ProfitCalcResult {
  const { buyAmount, profitRate, buyFeeRate, sellFeeRate, taxRate, includeFees } = input;

  if (buyAmount <= 0) {
    return { resultAmount: 0, buyFee: 0, netBuyAmount: 0 };
  }

  // 매수 수수료
  const buyFee = buyAmount * (buyFeeRate / 100);
  const netBuyAmount = buyAmount + buyFee;

  // 수익률 적용
  const grossSellAmount = netBuyAmount * (1 + profitRate / 100);

  if (!includeFees) {
    return {
      resultAmount: grossSellAmount,
      buyFee,
      netBuyAmount,
    };
  }

  // 매도 수수료 및 세금 포함
  const sellFee = grossSellAmount * (sellFeeRate / 100);
  const tax = (grossSellAmount - netBuyAmount) * (taxRate / 100);
  const resultAmount = grossSellAmount - sellFee - tax;

  return {
    resultAmount,
    buyFee,
    netBuyAmount,
  };
}

/**
 * 탭 2: 매수금액 + 매도금액 → 수익률 계산
 */
export function calculateProfitRate(input: ProfitRateInput): ProfitRateResult {
  const { buyAmount, sellAmount, buyFeeRate, sellFeeRate, taxRate, includeFees } = input;

  if (buyAmount <= 0 || sellAmount <= 0) {
    return {
      profitRate: 0,
      profit: 0,
      buyFee: 0,
      sellFee: 0,
      tax: 0,
      netProfit: 0,
      netBuyAmount: 0,
      netSellAmount: 0,
    };
  }

  const buyFee = buyAmount * (buyFeeRate / 100);
  const netBuyAmount = buyAmount + buyFee;

  if (!includeFees) {
    const profit = sellAmount - buyAmount;
    const profitRate = (profit / buyAmount) * 100;

    return {
      profitRate,
      profit,
      buyFee,
      sellFee: 0,
      tax: 0,
      netProfit: profit,
      netBuyAmount,
      netSellAmount: sellAmount,
    };
  }

  // 매도 수수료 및 세금 포함
  const sellFee = sellAmount * (sellFeeRate / 100);
  const grossProfit = sellAmount - netBuyAmount;
  const tax = grossProfit > 0 ? grossProfit * (taxRate / 100) : 0;
  const netProfit = sellAmount - netBuyAmount - sellFee - tax;
  const netSellAmount = sellAmount - sellFee;
  const profitRate = (netProfit / netBuyAmount) * 100;

  return {
    profitRate,
    profit: grossProfit,
    buyFee,
    sellFee,
    tax,
    netProfit,
    netBuyAmount,
    netSellAmount,
  };
}

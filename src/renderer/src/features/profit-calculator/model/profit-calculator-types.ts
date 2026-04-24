export type ProfitCalculatorTab = 'profit' | 'rate';

export interface FeeRates {
  buyFeeRate: number;
  sellFeeRate: number;
  taxRate: number;
}

export interface ProfitAmountState {
  buyAmount: number;
  includeFees: boolean;
  profitRate: number;
}

export interface ProfitRateState {
  buyAmount: number;
  includeFees: boolean;
  sellAmount: number;
}

export type FeeEnv = 'real' | 'mock';

export interface FeeSettings {
  buy: number;
  sell: number;
  tax: number;
}

export interface AllFeeSettings {
  real: FeeSettings;
  mock: FeeSettings;
}

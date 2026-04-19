export type PriceCorrectionStrategy = 'AGGRESSIVE' | 'CONSERVATIVE';

export interface PriceCorrectionSettings {
  buy: PriceCorrectionStrategy;
  sell: PriceCorrectionStrategy;
}

import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export type PriceCorrectionStrategy = 'AGGRESSIVE' | 'CONSERVATIVE';

export const PRICE_CORRECTION_DEFAULTS = {
  buy: 'AGGRESSIVE' as PriceCorrectionStrategy,
  sell: 'AGGRESSIVE' as PriceCorrectionStrategy,
} as const;

export function readPriceCorrectionConfig(repo: SettingsRepo): {
  buy: PriceCorrectionStrategy;
  sell: PriceCorrectionStrategy;
} {
  const validStrategies: PriceCorrectionStrategy[] = ['AGGRESSIVE', 'CONSERVATIVE'];

  const buyRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_BUY);
  const buy: PriceCorrectionStrategy =
    buyRaw !== null && validStrategies.includes(buyRaw as PriceCorrectionStrategy)
      ? (buyRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.buy;

  const sellRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_SELL);
  const sell: PriceCorrectionStrategy =
    sellRaw !== null && validStrategies.includes(sellRaw as PriceCorrectionStrategy)
      ? (sellRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.sell;

  return { buy, sell };
}

import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export type FeeEnv = 'real' | 'mock';

export const FEES_DEFAULTS = {
  real: { buy: 0.015, sell: 0.015, tax: 0.2 },
  mock: { buy: 0.35, sell: 0.35, tax: 0.2 },
} as const;

export function readFeesConfig(
  repo: SettingsRepo,
  env: FeeEnv,
): {
  buy: number;
  sell: number;
  tax: number;
} {
  const buyKey = env === 'real' ? SETTING_KEYS.FEES_REAL_BUY : SETTING_KEYS.FEES_MOCK_BUY;
  const sellKey = env === 'real' ? SETTING_KEYS.FEES_REAL_SELL : SETTING_KEYS.FEES_MOCK_SELL;
  const taxKey = env === 'real' ? SETTING_KEYS.FEES_REAL_TAX : SETTING_KEYS.FEES_MOCK_TAX;

  const defaults = FEES_DEFAULTS[env];

  const buyRaw = repo.get(buyKey);
  const buy = buyRaw !== null ? Number(buyRaw) : defaults.buy;

  const sellRaw = repo.get(sellKey);
  const sell = sellRaw !== null ? Number(sellRaw) : defaults.sell;

  const taxRaw = repo.get(taxKey);
  const tax = taxRaw !== null ? Number(taxRaw) : defaults.tax;

  return { buy, sell, tax };
}

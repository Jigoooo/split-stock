import type { CryptoKrwMarketCode } from '@shared/contracts';

const CRYPTO_WATCH_PREFILL_KEY = 'split-stock:add-crypto-watch-prefill';

export interface AddCryptoWatchPrefillPayload {
  accountId: number;
  market?: CryptoKrwMarketCode;
  watchId?: number;
}

export function storeAddCryptoWatchPrefill(payload: AddCryptoWatchPrefillPayload): void {
  window.localStorage.setItem(CRYPTO_WATCH_PREFILL_KEY, JSON.stringify(payload));
}

export function consumeAddCryptoWatchPrefill(): AddCryptoWatchPrefillPayload | null {
  const raw = window.localStorage.getItem(CRYPTO_WATCH_PREFILL_KEY);
  window.localStorage.removeItem(CRYPTO_WATCH_PREFILL_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as AddCryptoWatchPrefillPayload;
}

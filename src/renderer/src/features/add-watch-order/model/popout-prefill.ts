import type { WatchOrderFormPrefill } from './types';

const ADD_WATCH_ORDER_PREFILL_KEY = 'split-stock:add-watch-order-prefill';

export interface AddWatchOrderPrefillPayload {
  accountId: number;
  prefill: WatchOrderFormPrefill | null;
}

export function storeAddWatchOrderPrefill(payload: AddWatchOrderPrefillPayload): void {
  localStorage.setItem(ADD_WATCH_ORDER_PREFILL_KEY, JSON.stringify(payload));
}

export function consumeAddWatchOrderPrefill(): AddWatchOrderPrefillPayload | null {
  const raw = localStorage.getItem(ADD_WATCH_ORDER_PREFILL_KEY);
  if (!raw) return null;

  localStorage.removeItem(ADD_WATCH_ORDER_PREFILL_KEY);
  return JSON.parse(raw) as AddWatchOrderPrefillPayload;
}

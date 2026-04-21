import type { WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';

export interface WatchOrderFormPrefill {
  existingId?: number;
  pdno?: string;
  pdName?: string;
  targetPrice?: number;
  orderType?: WatchOrderType;
  qtyOrAmountMode?: WatchQtyMode;
  qty?: number;
  amountKrw?: number;
  /** ms epoch — 만료일. */
  expiresAtMs?: number;
}

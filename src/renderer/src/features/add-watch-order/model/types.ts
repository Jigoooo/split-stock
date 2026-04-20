import type {
  WatchComparator,
  WatchOrderType,
  WatchQtyMode,
  WatchSide,
} from '@renderer/entities/watch-order';

export interface WatchOrderFormPrefill {
  existingId?: number;
  pdno?: string;
  pdName?: string;
  side?: WatchSide;
  comparator?: WatchComparator;
  targetPrice?: number;
  orderType?: WatchOrderType;
  qtyOrAmountMode?: WatchQtyMode;
  qty?: number;
  amountKrw?: number;
  /** ms epoch — 만료일. */
  expiresAtMs?: number;
}

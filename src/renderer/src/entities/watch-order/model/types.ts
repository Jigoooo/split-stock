import { z } from 'zod';

/**
 * 통합 자동감시주문 — renderer 측 타입.
 * server schema(WatchOrderInputSchema)와 일관성 유지.
 * server는 Date 객체로 직렬화하지만 superjson 통과 후 Date 그대로 전달.
 */

export const WatchSourceSchema = z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']);
export type WatchSource = z.infer<typeof WatchSourceSchema>;

export const WatchSideSchema = z.enum(['BUY', 'SELL']);
export type WatchSide = z.infer<typeof WatchSideSchema>;

export const WatchComparatorSchema = z.enum(['LTE', 'GTE']);
export type WatchComparator = z.infer<typeof WatchComparatorSchema>;

export const WatchOrderTypeSchema = z.enum(['MARKET', 'LIMIT']);
export type WatchOrderType = z.infer<typeof WatchOrderTypeSchema>;

export const WatchQtyModeSchema = z.enum(['QTY', 'AMOUNT']);
export type WatchQtyMode = z.infer<typeof WatchQtyModeSchema>;

export const WatchStatusSchema = z.enum([
  'WATCHING',
  'PAUSED',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);
export type WatchStatus = z.infer<typeof WatchStatusSchema>;

export const WatchOrderSchema = z.object({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  pdno: z.string(),
  source: WatchSourceSchema,
  side: WatchSideSchema,
  targetPrice: z.number().int().positive(),
  comparator: WatchComparatorSchema,
  orderType: WatchOrderTypeSchema,
  qtyOrAmountMode: WatchQtyModeSchema,
  qty: z.number().int().nullable(),
  amountKrw: z.number().int().nullable(),
  nth: z.number().int().nullable(),
  sourceRefId: z.string().nullable(),
  expiresAt: z.date().nullable(),
  status: WatchStatusSchema,
  lastFailureReason: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  executedAt: z.date().nullable(),
});
export type WatchOrder = z.infer<typeof WatchOrderSchema>;

export const WatchHistoryItemSchema = z.object({
  id: z.number().int().positive(),
  at: z.date(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  message: z.string(),
  accountId: z.number().int().positive(),
  pdno: z.string().nullable(),
  source: WatchSourceSchema.nullable(),
  watchId: z.number().int().nullable(),
  reason: z.string().nullable(),
});
export type WatchHistoryItem = z.infer<typeof WatchHistoryItemSchema>;

export const WatchControlStateSchema = z.object({
  globalEnabled: z.boolean(),
  watchingCount: z.number().int().nonnegative(),
  pausedCount: z.number().int().nonnegative(),
  totalTrackedCount: z.number().int().nonnegative(),
});
export type WatchControlState = z.infer<typeof WatchControlStateSchema>;

/** UI 4탭 구분 — 현황(WATCHING) / 실행내역(EXECUTED) / 실패(FAILED) / 히스토리(전체). */
export type WatchTabKey = 'watching' | 'executed' | 'failed' | 'history';

export function tabToStatus(tab: WatchTabKey): WatchStatus | undefined {
  switch (tab) {
    case 'watching':
      return 'WATCHING';
    case 'executed':
      return 'EXECUTED';
    case 'failed':
      return 'FAILED';
    case 'history':
      return undefined; // 전체
  }
}

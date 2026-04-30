import { z } from 'zod';
import {
  cancelWatchOrder,
  createReservationBuyWatchOrder,
  getWatchControlState,
  listWatchHistory,
  listWatchOrders,
  pauseWatchOrder,
  resumeWatchOrder,
  setWatchGlobalEnabled,
  updateReservationBuyWatchOrder,
} from '../handlers/watch-handlers';
import { router, runtimeProcedure } from '../trpc-core';

const ListInputSchema = z.object({
  status: z.enum(['WATCHING', 'PAUSED', 'EXECUTED', 'FAILED', 'EXPIRED', 'CANCELLED']).optional(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).optional(),
  accountId: z.number().int().positive().optional(),
});

const HistoryItemSchema = z.object({
  id: z.number().int().positive(),
  at: z.date(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  message: z.string(),
  accountId: z.number().int().positive(),
  pdno: z.string().nullable(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).nullable(),
  watchId: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
});

const ReservationBuyBaseShape = {
  accountId: z.number().int().positive(),
  pdno: z.string().regex(/^\d{6}$/),
  targetPrice: z.number().int().positive(),
  orderType: z.enum(['MARKET', 'LIMIT']),
  qtyOrAmountMode: z.enum(['QTY', 'AMOUNT']),
  qty: z.number().int().positive().optional(),
  amountKrw: z.number().int().positive().optional(),
  expiresAt: z.union([z.number().int().positive(), z.date()]).optional(),
} as const;

const ReservationBuyCreateInputSchema = z
  .object(ReservationBuyBaseShape)
  .strict()
  .refine(
    (v) =>
      v.qtyOrAmountMode === 'QTY'
        ? v.qty !== undefined && v.amountKrw === undefined
        : v.amountKrw !== undefined && v.qty === undefined,
    {
      message: 'mode가 QTY면 qty만, AMOUNT면 amount_krw만 지정하세요 (반대 필드는 비워야 함)',
    },
  );

const ReservationBuyUpdateInputSchema = z
  .object({
    id: z.number().int().positive(),
    pdno: ReservationBuyBaseShape.pdno,
    targetPrice: ReservationBuyBaseShape.targetPrice,
    orderType: ReservationBuyBaseShape.orderType,
    qtyOrAmountMode: ReservationBuyBaseShape.qtyOrAmountMode,
    qty: ReservationBuyBaseShape.qty,
    amountKrw: ReservationBuyBaseShape.amountKrw,
    expiresAt: ReservationBuyBaseShape.expiresAt,
  })
  .strict()
  .refine(
    (v) =>
      v.qtyOrAmountMode === 'QTY'
        ? v.qty !== undefined && v.amountKrw === undefined
        : v.amountKrw !== undefined && v.qty === undefined,
    {
      message: 'mode가 QTY면 qty만, AMOUNT면 amount_krw만 지정하세요 (반대 필드는 비워야 함)',
    },
  );

/**
 * 통합 자동감시주문 라우터.
 * - list: 현황/실행내역/실패 탭에서 status별 필터링
 * - history: WATCH 카테고리 이벤트 로그 기반 lifecycle timeline
 * - control: 전역 ON/OFF, pause/resume/cancel/update
 * - create/update: 예약매수 전용 공개 입력 — 활성 계좌 한정
 */
export const watchRouter = router({
  list: runtimeProcedure
    .input(ListInputSchema)
    .query(({ ctx, input }) => listWatchOrders(ctx, input)),

  getControlState: runtimeProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => getWatchControlState(ctx, input)),

  setGlobalEnabled: runtimeProcedure
    .input(z.object({ enabled: z.boolean(), accountId: z.number().int().positive().optional() }))
    .mutation(({ ctx, input }) => setWatchGlobalEnabled(ctx, input)),

  pause: runtimeProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => pauseWatchOrder(ctx, input)),

  resume: runtimeProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => resumeWatchOrder(ctx, input)),

  cancel: runtimeProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => cancelWatchOrder(ctx, input)),

  create: runtimeProcedure
    .input(ReservationBuyCreateInputSchema)
    .mutation(({ ctx, input }) => createReservationBuyWatchOrder(ctx, input)),

  update: runtimeProcedure
    .input(ReservationBuyUpdateInputSchema)
    .mutation(({ ctx, input }) => updateReservationBuyWatchOrder(ctx, input)),

  history: runtimeProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional())
    .output(z.object({ items: z.array(HistoryItemSchema) }))
    .query(({ ctx, input }) => listWatchHistory(ctx, input)),
});

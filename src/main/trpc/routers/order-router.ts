import { KisOrderAmendRequestSchema, KisOrderRequestSchema } from '@shared/contracts';
import { z } from 'zod';
import { amendOrderHandler, cancelManyOrdersHandler } from '../handlers/order-mutation-handlers';
import { placeCashHandler } from '../handlers/order-place-handler';
import { listActiveOrdersHandler, listMyFillsHandler } from '../handlers/order-query-handlers';
import { router, runtimeProcedure } from '../trpc-core';

const AccountIdField = z.number().int().positive();
// broker를 명시하지 않은 renderer 호출(useQuery(undefined) 패턴)에 대한 backward-compat 기본값.
// KIS 단일 환경에서는 항상 'KIS'. KIWOOM 추가 시 renderer가 broker prop을 명시적으로 전달하므로 유지 필요.
const BrokerField = z.string().optional().default('KIS');

export const orderRouter = router({
  /**
   * 즉시 매수/매도 주문 — 박스권 분할매매의 수동(직접) 주문 경로.
   * 성공 시 orders 테이블에 PENDING으로 기록.
   */
  placeCash: runtimeProcedure
    .input(KisOrderRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(({ ctx, input }) => placeCashHandler(ctx, input)),

  /**
   * 주문 정정/취소 — accountId 명시 필수.
   */
  amend: runtimeProcedure
    .input(KisOrderAmendRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(({ ctx, input }) => amendOrderHandler(ctx, input)),

  /**
   * 미체결 주문 목록 (PENDING/PARTIAL) — 활성 계좌 한정.
   */
  listActive: runtimeProcedure
    .input(z.object({ accountId: AccountIdField.optional(), broker: BrokerField }).optional())
    .query(({ ctx, input }) => listActiveOrdersHandler(ctx, input ?? { broker: 'KIS' })),

  /**
   * 내 체결 주문 목록 — 활성 계좌 한정. FilledPane (MainPositionsPane L2 "실시간 체결") 용도.
   */
  listMyFills: runtimeProcedure
    .input(
      z
        .object({
          accountId: AccountIdField.optional(),
          broker: BrokerField,
          pdno: z
            .string()
            .refine((v) => /^\d{6}$/.test(v) || /^KRW-[A-Z0-9]+$/.test(v), 'invalid symbol')
            .optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(({ ctx, input }) => listMyFillsHandler(ctx, input ?? { broker: 'KIS', limit: 100 })),

  /**
   * 선택 주문 일괄 취소 — accountId 명시 필수. 호가창 UI에서 호출.
   */
  cancelMany: runtimeProcedure
    .input(z.object({ odnos: z.array(z.string()).min(1).max(50), accountId: AccountIdField }))
    .mutation(({ ctx, input }) => cancelManyOrdersHandler(ctx, input)),
});

import { TRPCError } from '@trpc/server';
import type { Context } from '../context';
import {
  ensureActiveAccountId,
  ensureWatchEngine,
  getOwnedWatchOrder,
  logWatchEvent,
  type ReservationBuyCreateInput,
  type ReservationBuyUpdateInput,
} from './watch-handler-shared';

export function createReservationBuyWatchOrder(ctx: Context, input: ReservationBuyCreateInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌로의 자동감시주문 등록은 허용되지 않습니다.',
    });
  }
  const result = watchEngine.register({
    accountId: input.accountId,
    pdno: input.pdno,
    source: 'CUSTOM',
    side: 'BUY',
    targetPrice: input.targetPrice,
    comparator: 'LTE',
    orderType: input.orderType,
    qtyOrAmountMode: input.qtyOrAmountMode,
    ...(input.qtyOrAmountMode === 'QTY' ? { qty: input.qty as number } : {}),
    ...(input.qtyOrAmountMode === 'AMOUNT' ? { amountKrw: input.amountKrw as number } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
      message: `등록 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.created',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

export function updateReservationBuyWatchOrder(ctx: Context, input: ReservationBuyUpdateInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  if (owned.source !== 'CUSTOM') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '수동 예약매수만 수정할 수 있습니다.',
    });
  }
  const result = watchEngine.update(input.id, {
    accountId: activeAccountId,
    pdno: input.pdno,
    source: 'CUSTOM',
    side: 'BUY',
    targetPrice: input.targetPrice,
    comparator: 'LTE',
    orderType: input.orderType,
    qtyOrAmountMode: input.qtyOrAmountMode,
    ...(input.qtyOrAmountMode === 'QTY' ? { qty: input.qty as number } : {}),
    ...(input.qtyOrAmountMode === 'AMOUNT' ? { amountKrw: input.amountKrw as number } : {}),
    sourceRefId: owned.sourceRefId ?? undefined,
    metadata: owned.metadata ?? undefined,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `수정 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.updated',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

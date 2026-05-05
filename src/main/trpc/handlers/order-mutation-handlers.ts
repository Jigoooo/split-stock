import type { KisOrderAmendRequestSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { lots, orders } from '../../db/schema';
import { reconcileCancelledSellLot } from '../../trading/partial-sell-lot-reconciliation';
import type { Context } from '../context';
import { requireAccountId } from '../router-helpers';
import {
  brokerAmend,
  brokerCancel,
  readFilledQtyByOrderId,
  toLegacyAck,
} from './order-router-helpers';

const STOCK_BROKER = 'KIS';

type AmendInput = z.infer<typeof KisOrderAmendRequestSchema> & { accountId: number };

export async function amendOrderHandler(ctx: Context, input: AmendInput) {
  const env = ctx.currentEnv;
  if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
  const accountId = requireAccountId(input);
  const broker = ctx.brokerForAccount(accountId);
  if (!broker) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
  }
  const orderRow = ctx.db
    .select({ pdno: orders.pdno })
    .from(orders)
    .where(
      and(
        eq(orders.broker, STOCK_BROKER),
        eq(orders.odno, input.orgOdno),
        eq(orders.accountId, accountId),
      ),
    )
    .get();
  const amendParams = {
    orgOrgNo: input.orgOrgNo,
    orgOdno: input.orgOdno,
    qty: input.qty,
    price: input.price,
    division: input.division,
    qtyAllOrder: input.qtyAllOrder,
    ...(orderRow?.pdno !== undefined && { symbol: orderRow.pdno }),
  };
  const r =
    input.action === 'cancel'
      ? await brokerCancel(broker, amendParams)
      : await brokerAmend(broker, amendParams);
  if (r.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `주문 정정/취소 실패: ${r.error.kind}`,
    });
  }
  const result = { value: toLegacyAck(r.value) };
  if (input.action === 'cancel') {
    ctx.db
      .update(orders)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(orders.broker, STOCK_BROKER),
          eq(orders.odno, input.orgOdno),
          eq(orders.accountId, accountId),
        ),
      )
      .run();
    cancelPendingWatcherEntry(ctx, input.orgOdno);
  }
  return result.value;
}

export async function cancelManyOrdersHandler(
  ctx: Context,
  input: { odnos: string[]; accountId: number },
) {
  const env = ctx.currentEnv;
  if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
  const accountId = requireAccountId(input);
  const rows = ctx.db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.broker, STOCK_BROKER),
        inArray(orders.odno, input.odnos),
        eq(orders.accountId, accountId),
      ),
    )
    .all();
  const broker = ctx.brokerForAccount(accountId);
  if (!broker) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
  }
  const results: Array<{ odno: string; ok: boolean; reason?: string }> = [];
  const filledQtyByOrderId = readFilledQtyByOrderId(
    ctx.db,
    rows.map((row) => row.id),
  );
  for (const row of rows) {
    const filledQty = Math.min(row.qty, filledQtyByOrderId.get(row.id) ?? 0);
    const remainingQty = Math.max(0, row.qty - filledQty);
    if (remainingQty <= 0) {
      ctx.db
        .update(orders)
        .set({ status: 'FILLED', filledAt: row.filledAt ?? new Date() })
        .where(
          and(
            eq(orders.broker, STOCK_BROKER),
            eq(orders.odno, row.odno),
            eq(orders.accountId, accountId),
          ),
        )
        .run();
      results.push({
        odno: row.odno,
        ok: false,
        reason: '이미 전량 체결되어 취소할 수 없습니다',
      });
      continue;
    }
    if (!row.orgNo) {
      results.push({
        odno: row.odno,
        ok: false,
        reason: 'orgNo 누락 — 정정/취소 불가 (원주문 접수 응답 확인 필요)',
      });
      continue;
    }
    const r = await brokerCancel(broker, {
      orgOrgNo: row.orgNo,
      orgOdno: row.odno,
      division: row.division as 'LIMIT' | 'MARKET',
      qty: remainingQty,
      price: 0,
      qtyAllOrder: true,
      symbol: row.pdno,
    });
    if (r.isOk()) {
      markCancelledOrder(ctx, row, filledQty, accountId);
      cancelPendingWatcherEntry(ctx, row.odno);
      results.push({ odno: row.odno, ok: true });
    } else {
      results.push({ odno: row.odno, ok: false, reason: r.error.msg });
    }
  }
  return { results };
}

function markCancelledOrder(
  ctx: Context,
  row: typeof orders.$inferSelect,
  filledQty: number,
  accountId: number,
): void {
  ctx.db
    .update(orders)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(orders.broker, STOCK_BROKER),
        eq(orders.odno, row.odno),
        eq(orders.accountId, accountId),
      ),
    )
    .run();
  if (row.lotId === null) return;
  if (row.side === 'BUY') {
    if (filledQty === 0) {
      ctx.db
        .delete(lots)
        .where(and(eq(lots.id, row.lotId), eq(lots.broker, STOCK_BROKER)))
        .run();
    } else {
      ctx.db
        .update(lots)
        .set({
          status: 'OPEN',
          buyPrice: row.price,
          qty: filledQty,
          amountKrw: row.price * filledQty,
        })
        .where(and(eq(lots.id, row.lotId), eq(lots.broker, STOCK_BROKER)))
        .run();
    }
  } else if (row.side === 'SELL') {
    reconcileCancelledSellLot(ctx.db, {
      lotId: row.lotId,
      filledQty,
      executionPrice: row.price,
      now: new Date(),
    });
  }
}

function cancelPendingWatcherEntry(ctx: Context, odno: string): void {
  if (!ctx.pendingOrderWatcher) return;
  const active = ctx.pendingOrderWatcher.listActive();
  for (const entry of active) {
    if (entry.odno !== odno) continue;
    ctx.pendingOrderWatcher.cancel({
      pdno: entry.pdno,
      side: entry.side,
      nth: entry.nth,
    });
  }
}

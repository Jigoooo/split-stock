import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { orders } from '../../db/schema';
import type { Context } from '../context';
import { resolveAccountId } from '../router-helpers';
import { buildActiveOrderViews, readFilledQtyByOrderId } from './order-router-helpers';

export function listActiveOrdersHandler(
  ctx: Context,
  input: { accountId?: number | undefined } = {},
) {
  const accountId = resolveAccountId(ctx, input);
  const rows = ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.accountId, accountId), inArray(orders.status, ['PENDING', 'PARTIAL'])))
    .orderBy(asc(orders.placedAt))
    .all();
  const filledQtyByOrderId = readFilledQtyByOrderId(
    ctx.db,
    rows.map((row) => row.id),
  );
  return {
    orders: buildActiveOrderViews(rows, filledQtyByOrderId),
  };
}

export function listMyFillsHandler(
  ctx: Context,
  input: {
    accountId?: number | undefined;
    pdno?: string | undefined;
    limit?: number | undefined;
  } = {},
) {
  const accountId = resolveAccountId(ctx, input);
  const pdno = input.pdno;
  const limit = input.limit ?? 100;
  const conditions = [eq(orders.accountId, accountId)];
  if (pdno) conditions.push(eq(orders.pdno, pdno));
  const rows = ctx.db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.filledAt), desc(orders.placedAt))
    .all();
  const filledQtyByOrderId = readFilledQtyByOrderId(
    ctx.db,
    rows.map((row) => row.id),
  );
  return {
    orders: rows
      .filter(
        (row) =>
          row.status === 'FILLED' ||
          row.status === 'PARTIAL' ||
          (filledQtyByOrderId.get(row.id) ?? 0) > 0,
      )
      .slice(0, limit),
  };
}

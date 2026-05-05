import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { orders } from '../../db/schema';
import type { Context } from '../context';
import { resolveAccountId } from '../router-helpers';
import { buildActiveOrderViews, readFilledQtyByOrderId } from './order-router-helpers';

const STOCK_BROKER = 'KIS';

/**
 * 주어진 pdno 목록에 대응하는 종목명 lookup map 을 stock_master 에서 일괄 조회.
 * 미존재 종목은 map 에 없음 → caller 가 fallback 처리.
 */
function readNamesByPdno(ctx: Context, pdnos: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (pdnos.length === 0) return map;
  const unique = Array.from(new Set(pdnos));
  for (const pdno of unique) {
    const entry = ctx.stockMasterRepo.find(pdno);
    if (entry?.name) map.set(pdno, entry.name);
  }
  return map;
}

export function listActiveOrdersHandler(
  ctx: Context,
  input: { accountId?: number | undefined; broker?: string | undefined } = {},
) {
  const accountId = resolveAccountId(ctx, input);
  const brokerKey = input.broker ?? STOCK_BROKER;
  const rows = ctx.db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.broker, brokerKey),
        eq(orders.accountId, accountId),
        inArray(orders.status, ['PENDING', 'PARTIAL']),
      ),
    )
    .orderBy(asc(orders.placedAt))
    .all();
  const filledQtyByOrderId = readFilledQtyByOrderId(
    ctx.db,
    rows.map((row) => row.id),
  );
  const views = buildActiveOrderViews(rows, filledQtyByOrderId);
  const namesByPdno = readNamesByPdno(
    ctx,
    views.map((row) => row.pdno),
  );
  return {
    orders: views.map((row) => ({ ...row, name: namesByPdno.get(row.pdno) ?? null })),
  };
}

export function listMyFillsHandler(
  ctx: Context,
  input: {
    accountId?: number | undefined;
    broker?: string | undefined;
    pdno?: string | undefined;
    limit?: number | undefined;
  } = {},
) {
  const accountId = resolveAccountId(ctx, input);
  const pdno = input.pdno;
  const limit = input.limit ?? 100;
  const brokerKey = input.broker ?? STOCK_BROKER;
  const conditions = [eq(orders.broker, brokerKey), eq(orders.accountId, accountId)];
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
  const filtered = rows
    .filter(
      (row) =>
        row.status === 'FILLED' ||
        row.status === 'PARTIAL' ||
        (filledQtyByOrderId.get(row.id) ?? 0) > 0,
    )
    .slice(0, limit);
  const namesByPdno = readNamesByPdno(
    ctx,
    filtered.map((row) => row.pdno),
  );
  return {
    orders: filtered.map((row) => ({ ...row, name: namesByPdno.get(row.pdno) ?? null })),
  };
}

import { isCryptoBroker } from '@shared/contracts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { cryptoFills, cryptoInstruments, cryptoOrders, orders } from '../../db/schema';
import type { Context } from '../context';
import { resolveAccountId } from '../router-helpers';
import { resolveActiveDomesticBroker } from './account-shared';
import { buildActiveOrderViews, readFilledQtyByOrderId } from './order-router-helpers';

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
  const brokerKey = input.broker ?? resolveActiveDomesticBroker(ctx);
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
    brokerKey,
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

/**
 * NM-017: UPBIT 체결 내역 — cryptoFills 권위적 source. cryptoOrders join 으로 ordType 획득,
 * cryptoInstruments lookup 으로 한글명. 도메스틱 orders row shape 으로 normalize 후 반환.
 */
function listCryptoFills(
  ctx: Context,
  accountId: number,
  pdno: string | undefined,
  limit: number,
): { orders: ReturnType<typeof normalizeCryptoFillRow>[] } {
  const conditions = [eq(cryptoFills.accountId, accountId), eq(cryptoFills.exchange, 'UPBIT')];
  if (pdno) conditions.push(eq(cryptoFills.market, pdno));
  const fillRows = ctx.db
    .select()
    .from(cryptoFills)
    .where(and(...conditions))
    .orderBy(desc(cryptoFills.executedAt))
    .limit(limit)
    .all();
  if (fillRows.length === 0) return { orders: [] };

  const uuids = Array.from(new Set(fillRows.map((r) => r.orderUuid)));
  const orderRows = ctx.db
    .select({
      uuid: cryptoOrders.uuid,
      ordType: cryptoOrders.ordType,
      placedAt: cryptoOrders.placedAt,
    })
    .from(cryptoOrders)
    .where(and(eq(cryptoOrders.accountId, accountId), inArray(cryptoOrders.uuid, uuids)))
    .all();
  const orderByUuid = new Map(orderRows.map((o) => [o.uuid ?? '', o]));

  const markets = Array.from(new Set(fillRows.map((r) => r.market)));
  const instrumentRows = ctx.db
    .select({ market: cryptoInstruments.market, koreanName: cryptoInstruments.koreanName })
    .from(cryptoInstruments)
    .where(and(eq(cryptoInstruments.exchange, 'UPBIT'), inArray(cryptoInstruments.market, markets)))
    .all();
  const nameByMarket = new Map(instrumentRows.map((i) => [i.market, i.koreanName]));

  return {
    orders: fillRows.map((row) => normalizeCryptoFillRow(row, orderByUuid, nameByMarket)),
  };
}

function normalizeCryptoFillRow(
  fill: typeof cryptoFills.$inferSelect,
  orderByUuid: Map<string, { uuid: string | null; ordType: string; placedAt: Date }>,
  nameByMarket: Map<string, string>,
) {
  const order = orderByUuid.get(fill.orderUuid);
  const ordType = order?.ordType ?? 'limit';
  const division = ordType === 'limit' ? 'LIMIT' : 'MARKET';
  return {
    id: fill.id,
    accountId: fill.accountId,
    broker: 'UPBIT' as const,
    pdno: fill.market,
    name: nameByMarket.get(fill.market) ?? null,
    side: fill.side === 'bid' ? ('BUY' as const) : ('SELL' as const),
    qty: Number(fill.volume),
    price: Number(fill.price),
    division,
    status: 'FILLED' as const,
    placedAt: order?.placedAt?.getTime() ?? fill.executedAt.getTime(),
    filledAt: fill.executedAt.getTime(),
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
  const brokerKey = input.broker ?? resolveActiveDomesticBroker(ctx);
  // NM-017: UPBIT 분기 — cryptoFills 기반 정규화 반환.
  if (isCryptoBroker(brokerKey)) {
    return listCryptoFills(ctx, accountId, pdno, limit);
  }
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
    brokerKey,
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

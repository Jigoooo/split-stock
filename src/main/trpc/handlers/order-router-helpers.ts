import type { OrderAck } from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { getRegularMarketSessionKst } from '@shared/trading/market-session';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { err } from 'neverthrow';
import type { BrokerPort } from '../../brokers/ports/broker-port';
import type { Db } from '../../db/client';
import { lots, trades } from '../../db/schema';
import type { EventLogger } from '../../logging/event-logger';
import type { LotsRepo } from '../../trading/lots-repo';
import { createPendingBuyLot } from '../../trading/order-lot-link';

/** 도메인 OrderAck → KIS NormalizedOrderAck shape (renderer wire compat). */
export function toLegacyAck(ack: OrderAck) {
  return {
    odno: ack.brokerOrderId,
    ...(ack.brokerOrgNo !== undefined && { orgNo: ack.brokerOrgNo }),
    ...(ack.acceptedAt !== undefined && { orderedAt: ack.acceptedAt }),
  };
}

/** broker 의 cancel/amend 결과를 KIS amend ack shape 으로 정규화. */
export async function brokerCancel(
  broker: BrokerPort,
  params: {
    orgOrgNo: string;
    orgOdno: string;
    qty: number;
    price: number;
    division: 'LIMIT' | 'MARKET';
    qtyAllOrder: boolean;
    /** Kiwoom kt10003 stk_cd 필수. KIS 는 무시. */
    symbol?: string;
  },
) {
  return broker.cancelOrder({
    brokerOrderId: params.orgOdno,
    brokerOrgNo: params.orgOrgNo,
    qty: params.qty,
    price: params.price,
    kind: params.division,
    qtyAllOrder: params.qtyAllOrder,
    all: params.qtyAllOrder,
    ...(params.symbol !== undefined && { symbol: params.symbol }),
  });
}

export async function brokerAmend(
  broker: BrokerPort,
  params: {
    orgOrgNo: string;
    orgOdno: string;
    qty: number;
    price: number;
    division: 'LIMIT' | 'MARKET';
    qtyAllOrder: boolean;
    /** Kiwoom kt10002 stk_cd 필수. KIS 는 무시. */
    symbol?: string;
  },
) {
  return broker.amendOrder({
    brokerOrderId: params.orgOdno,
    brokerOrgNo: params.orgOrgNo,
    qty: params.qty,
    price: params.price,
    kind: params.division,
    qtyAllOrder: params.qtyAllOrder,
    ...(params.symbol !== undefined && { symbol: params.symbol }),
  });
}

export async function assertManualOrderAllowed(input: {
  broker: BrokerPort;
  accountId: number;
  pdno: string;
  logger: Pick<EventLogger, 'log'>;
  now?: Date;
}): Promise<void> {
  const session = getRegularMarketSessionKst(input.now ?? new Date());
  if (session.isWeekend) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '주말에는 국내 정규장 주문을 보낼 수 없습니다.',
    });
  }

  const status = await input.broker.getTradingDayStatus(parseYyyymmdd(session.date));
  if (status.isErr()) {
    input.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'manual-order.market-session.unknown',
      payload: {
        accountId: input.accountId,
        pdno: input.pdno,
        brokerId: input.broker.brokerId,
        env: input.broker.env,
        kind: status.error.kind,
        msg: status.error.msg,
      },
    });
    throw new TRPCError({ code: 'FORBIDDEN', message: '거래일 확인 실패로 주문을 차단했습니다.' });
  }
  const verdict = status.value;
  if (verdict.source === 'UNKNOWN' || verdict.stale) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `거래일 확인 불가로 주문을 차단했습니다. (${verdict.reason})`,
    });
  }
  if (!verdict.openDay) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `휴장일 주문을 차단했습니다. (${verdict.reason})`,
    });
  }
  if (
    verdict.openMinute === null ||
    verdict.closeMinute === null ||
    session.minutes < verdict.openMinute ||
    session.minutes > verdict.closeMinute
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '정규장 시간이 아니므로 주문을 차단했습니다.',
    });
  }
}

function parseYyyymmdd(yyyymmdd: string): Date {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(y, m, d);
}

export function readFilledQtyByOrderId(db: Db, orderIds: number[]): Map<number, number> {
  if (orderIds.length === 0) return new Map();
  const tradeRows = db.select().from(trades).where(inArray(trades.orderId, orderIds)).all();
  const filledQtyByOrderId = new Map<number, number>();
  for (const trade of tradeRows) {
    const prev = filledQtyByOrderId.get(trade.orderId) ?? 0;
    filledQtyByOrderId.set(trade.orderId, prev + trade.qty);
  }
  return filledQtyByOrderId;
}

export function buildActiveOrderViews<T extends { id: number; qty: number; status: string }>(
  rows: T[],
  filledQtyByOrderId: Map<number, number>,
): Array<T & { filledQty: number; remainingQty: number; status: string }> {
  return rows
    .map((row) => {
      const filledQty = Math.min(row.qty, filledQtyByOrderId.get(row.id) ?? 0);
      const remainingQty = Math.max(0, row.qty - filledQty);
      const status = filledQty > 0 && remainingQty > 0 ? 'PARTIAL' : row.status;
      return {
        ...row,
        status,
        filledQty,
        remainingQty,
      };
    })
    .filter((row) => row.remainingQty > 0);
}

export function reserveManualBuyLot(
  ctx: { logger: EventLogger; lotsRepo: LotsRepo },
  input: {
    accountId: number;
    pdno: string;
    placedAt: Date;
    price: number;
    qty: number;
  },
): { lotId: number; nth: number } {
  const linked = createPendingBuyLot(
    {
      logger: ctx.logger,
      lotsRepo: ctx.lotsRepo,
    },
    {
      accountId: input.accountId,
      pdno: input.pdno,
      placedAt: input.placedAt,
      price: input.price,
      qty: input.qty,
      source: 'MANUAL',
    },
  );
  if (linked.lotId === null) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '매수 차수 예약 실패: 로컬 BUYING 차수를 생성하지 못했습니다.',
    });
  }
  return { lotId: linked.lotId, nth: linked.nth };
}

export function reserveManualSellLot(
  ctx: { db: Db; lotsRepo: Pick<LotsRepo, 'listRows'> },
  input: { accountId: number; pdno: string; qty: number },
): { lotId: number; nth: number } {
  const rows = ctx.lotsRepo.listRows(input.accountId, input.pdno);
  if (rows.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '매도 차수 조회 실패',
    });
  }
  const target = rows.value.filter((lot) => lot.status === 'OPEN').sort((a, b) => b.nth - a.nth)[0];
  if (!target || input.qty > target.qty) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        '매도 가능한 단일 OPEN 차수가 없습니다. 여러 차수 합산 매도는 아직 지원하지 않습니다.',
    });
  }
  const reserved = ctx.db
    .update(lots)
    .set({ status: 'SELLING' })
    .where(and(eq(lots.id, target.id), eq(lots.status, 'OPEN')))
    .run();
  if (reserved.changes === 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: '선택된 차수가 이미 매도 진행 중입니다. 최신 상태를 다시 확인해주세요.',
    });
  }
  return { lotId: target.id, nth: target.nth };
}

export function rollbackManualOrderLot(
  ctx: { db: Db; logger: Pick<EventLogger, 'log'>; lotsRepo: Pick<LotsRepo, 'updateLotStatus'> },
  linkedLot: { lotId: number; side: 'BUY' | 'SELL' },
): void {
  try {
    if (linkedLot.side === 'SELL') {
      ctx.lotsRepo.updateLotStatus({ lotId: linkedLot.lotId, status: 'OPEN' });
      return;
    }
    ctx.db.delete(lots).where(eq(lots.id, linkedLot.lotId)).run();
  } catch (cause) {
    ctx.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-reservation.rollback-failed',
      payload: {
        lotId: linkedLot.lotId,
        reason: cause instanceof Error ? cause.message : String(cause),
        side: linkedLot.side,
      },
    });
  }
}

export async function cancelAcceptedOrderAfterLocalFailure(
  broker: BrokerPort,
  ack: { odno: string; orgNo?: string },
  opts: {
    pdno: string;
    division: 'LIMIT' | 'MARKET';
    logger: Pick<EventLogger, 'log'>;
  },
): Promise<void> {
  if (!ack.orgNo && broker.brokerId === 'KIS') {
    opts.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-failure.cancel-skipped-orgno-missing',
      payload: { odno: ack.odno, pdno: opts.pdno },
    });
    return;
  }
  const cancelR = await brokerCancel(broker, {
    orgOrgNo: ack.orgNo ?? '',
    orgOdno: ack.odno,
    qty: 0,
    price: 0,
    division: opts.division,
    qtyAllOrder: true,
    symbol: opts.pdno,
  }).catch((cause) =>
    err(
      makeBrokerError({
        brokerId: broker.brokerId,
        kind: 'UNKNOWN',
        msg: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
    ),
  );
  if (cancelR.isErr()) {
    opts.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-failure.cancel-failed',
      payload: {
        odno: ack.odno,
        pdno: opts.pdno,
        kind: cancelR.error.kind,
        msg: cancelR.error.msg,
      },
    });
  }
}

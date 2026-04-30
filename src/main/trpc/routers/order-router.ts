import type { OrderAck } from '@shared/contracts';
import {
  KisOrderAmendRequestSchema,
  KisOrderRequestSchema,
  makeBrokerError,
} from '@shared/contracts';
import { correctLimitPrice } from '@shared/market-rules';
import { getRegularMarketSessionKst } from '@shared/trading/market-session';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { err } from 'neverthrow';
import { z } from 'zod';
import type { BrokerPort } from '../../brokers/ports/broker-port';
import type { Db } from '../../db/client';
import { lots, orders, trades } from '../../db/schema';
import { readPendingCancelConfig, readPriceCorrectionConfig } from '../../db/settings-repo';
import type { EventLogger } from '../../logging/event-logger';
import type { LotsRepo } from '../../trading/lots-repo';
import { createPendingBuyLot } from '../../trading/order-lot-link';
import { reconcileCancelledSellLot } from '../../trading/partial-sell-lot-reconciliation';
import { requireAccountId, resolveAccountId } from '../router-helpers';
import { authedProcedure, router } from '../trpc-core';

/** 도메인 OrderAck → KIS NormalizedOrderAck shape (renderer wire compat). */
function toLegacyAck(ack: OrderAck) {
  return {
    odno: ack.brokerOrderId,
    ...(ack.brokerOrgNo !== undefined && { orgNo: ack.brokerOrgNo }),
    ...(ack.acceptedAt !== undefined && { orderedAt: ack.acceptedAt }),
  };
}

/** broker 의 cancel/amend 결과를 KIS amend ack shape 으로 정규화. */
async function brokerCancel(
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

async function brokerAmend(
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

const AccountIdField = z.number().int().positive();

async function assertManualOrderAllowed(input: {
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

function readFilledQtyByOrderId(db: Db, orderIds: number[]): Map<number, number> {
  if (orderIds.length === 0) return new Map();
  const tradeRows = db.select().from(trades).where(inArray(trades.orderId, orderIds)).all();
  const filledQtyByOrderId = new Map<number, number>();
  for (const trade of tradeRows) {
    const prev = filledQtyByOrderId.get(trade.orderId) ?? 0;
    filledQtyByOrderId.set(trade.orderId, prev + trade.qty);
  }
  return filledQtyByOrderId;
}

function buildActiveOrderViews<
  T extends Array<typeof orders.$inferSelect & { id: number; qty: number; status: string }>,
>(rows: T, filledQtyByOrderId: Map<number, number>) {
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

function reserveManualBuyLot(
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

function reserveManualSellLot(
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

function rollbackManualOrderLot(
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

async function cancelAcceptedOrderAfterLocalFailure(
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

export const orderRouter = router({
  /**
   * 즉시 매수/매도 주문 — 매직스플릿의 수동(직접) 주문 경로.
   * 안전장치:
   *   - PROD에서는 호출측이 확인 모달을 거쳐야 한다 (renderer 책임).
   *   - accountId 명시 필수 — 활성 계좌 fallback 거부 (다른 계좌 자금 잘못 거래 방지).
   * 성공 시 orders 테이블에 PENDING으로 기록.
   */
  placeCash: authedProcedure
    .input(KisOrderRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const broker = ctx.brokerForAccount(accountId);
      if (!broker) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      await assertManualOrderAllowed({ broker, accountId, pdno: input.pdno, logger: ctx.logger });
      // 안전 스위치 체크: 해당 계좌의 SafetyState 만 확인 (per-account 격리).
      const safety = ctx.safetyRegistry.get(accountId);
      if (!safety.canTrade(input.pdno)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '안전 스위치에 의해 해당 종목 거래가 차단됨',
        });
      }

      // 자동보정: LIMIT 주문가를 호가단위에 맞게 보정 (BUY/SELL 별 strategy 적용).
      // 예약/자동매매 경로(watch-order-executor)와 동일한 보정을 즉시주문에도 적용해
      // 호가 미스매치로 인한 호가창 외 가격 전송을 방지한다.
      const priceCorrectionCfg = readPriceCorrectionConfig(ctx.settingsRepo);
      const correctedPrice =
        input.division === 'LIMIT'
          ? correctLimitPrice({
              targetPrice: input.price,
              side: input.side,
              strategy: input.side === 'BUY' ? priceCorrectionCfg.buy : priceCorrectionCfg.sell,
            })
          : 0;
      const correctedInput = { ...input, price: correctedPrice };

      const now = new Date();
      const linkedLot =
        input.side === 'BUY'
          ? {
              ...reserveManualBuyLot(ctx, {
                accountId,
                pdno: input.pdno,
                placedAt: now,
                price: correctedPrice,
                qty: input.qty,
              }),
              side: 'BUY' as const,
            }
          : {
              ...reserveManualSellLot(ctx, {
                accountId,
                pdno: input.pdno,
                qty: input.qty,
              }),
              side: 'SELL' as const,
            };

      let placeR: Awaited<ReturnType<BrokerPort['placeOrder']>>;
      try {
        placeR = await broker.placeOrder({
          side: correctedInput.side,
          symbol: correctedInput.pdno,
          qty: correctedInput.qty,
          price: correctedInput.price,
          kind: correctedInput.division,
        });
      } catch (cause) {
        rollbackManualOrderLot(ctx, linkedLot);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `주문 실패: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
      if (placeR.isErr()) {
        rollbackManualOrderLot(ctx, linkedLot);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `주문 실패: ${placeR.error.kind} - ${placeR.error.msg}`,
        });
      }
      const result = { value: toLegacyAck(placeR.value) };

      try {
        ctx.db
          .insert(orders)
          .values({
            accountId,
            lotId: linkedLot.lotId,
            odno: result.value.odno,
            orgNo: result.value.orgNo ?? null,
            pdno: input.pdno,
            side: input.side,
            division: input.division,
            qty: input.qty,
            price: correctedPrice,
            status: 'PENDING',
            placedAt: now,
          })
          .run();
      } catch (cause) {
        rollbackManualOrderLot(ctx, linkedLot);
        await cancelAcceptedOrderAfterLocalFailure(broker, result.value, {
          pdno: input.pdno,
          division: input.division,
          logger: ctx.logger,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `주문 로컬 기록 실패 — broker 주문 취소를 요청했습니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        });
      }

      // NM-001: 미체결 자동취소 감시 등록.
      // - 설정 enabled=false이면 스킵.
      // - LIMIT 주문만 대상 (MARKET은 즉시 체결되므로 PENDING 지속 안 함).
      // - orgNo가 없으면 KIS cancel API 호출이 불가 — 감시 등록 생략.
      const pendingCfg = readPendingCancelConfig(ctx.settingsRepo);
      if (
        pendingCfg.enabled &&
        input.division === 'LIMIT' &&
        result.value.orgNo &&
        ctx.pendingOrderWatcher
      ) {
        ctx.pendingOrderWatcher.register({
          pdno: input.pdno,
          side: input.side,
          // nth: 매직스플릿 차수 개념이나 수동 주문에서는 (pdno, side) 중복 등록 방지용 키로만 사용.
          // odno 기반 숫자 파싱이 안정적이지 않아 타임스탬프 기반 유사-유일 값 사용.
          nth: linkedLot.nth ?? Date.now() % 1_000_000,
          odno: result.value.odno,
          orgNo: result.value.orgNo,
          qty: input.qty,
          accountId,
        });
      }

      // 즉시주문 직후 주문 상태 보정 → 잔고 갱신 순서로 수렴시킨다.
      // 체결통보가 없는 환경에서도 stale 윈도우를 줄이되, broker REST 조회가 source of truth다.
      void ctx.currentStateSync?.trigger('trade-event', {
        accountId,
        brokerOrderId: result.value.odno,
        symbol: input.pdno,
      });

      // B1: 보정 적용 시 사용자에게 명시적 안내가 가도록 응답에 priceCorrection 메타 포함.
      const priceCorrection =
        input.division === 'LIMIT' && correctedPrice !== input.price
          ? {
              applied: true as const,
              originalPrice: input.price,
              correctedPrice,
              strategy: input.side === 'BUY' ? priceCorrectionCfg.buy : priceCorrectionCfg.sell,
            }
          : { applied: false as const };

      if (priceCorrection.applied) {
        ctx.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'order.price-correction.applied',
          payload: {
            accountId,
            pdno: input.pdno,
            side: input.side,
            originalPrice: priceCorrection.originalPrice,
            correctedPrice: priceCorrection.correctedPrice,
            strategy: priceCorrection.strategy,
          },
        });
      }

      return { ...result.value, priceCorrection };
    }),

  /**
   * 주문 정정/취소 — accountId 명시 필수.
   */
  amend: authedProcedure
    .input(KisOrderAmendRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const broker = ctx.brokerForAccount(accountId);
      if (!broker) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      // Kiwoom kt10002/kt10003 은 stk_cd 필수 — orders 테이블에서 원주문 종목 조회.
      const orderRow = ctx.db
        .select({ pdno: orders.pdno })
        .from(orders)
        .where(and(eq(orders.odno, input.orgOdno), eq(orders.accountId, accountId)))
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
      // 취소 성공 시 기존 order 상태를 CANCELLED로 (계좌 한정).
      if (input.action === 'cancel') {
        ctx.db
          .update(orders)
          .set({ status: 'CANCELLED' })
          .where(and(eq(orders.odno, input.orgOdno), eq(orders.accountId, accountId)))
          .run();
        // NM-001: 수동 취소된 주문은 자동취소 감시에서도 제거 — 불필요한 재시도 방지.
        if (ctx.pendingOrderWatcher) {
          const active = ctx.pendingOrderWatcher.listActive();
          for (const entry of active) {
            if (entry.odno === input.orgOdno) {
              ctx.pendingOrderWatcher.cancel({
                pdno: entry.pdno,
                side: entry.side,
                nth: entry.nth,
              });
            }
          }
        }
      }
      return result.value;
    }),

  /**
   * 미체결 주문 목록 (PENDING/PARTIAL) — 활성 계좌 한정.
   */
  listActive: authedProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
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
    }),

  /**
   * 내 체결 주문 목록 — 활성 계좌 한정. FilledPane (MainPositionsPane L2 "실시간 체결")
   * 용도. 시장 전체 tick 피드(useTradeFeed)와 구분 — 여기는 "내 주문의 체결/부분체결
   * 확인" 목적이라 본인 orders 테이블의 FILLED/PARTIAL 만 반환.
   *
   * pdno 필터는 선택 — 지정 시 해당 종목의 내 체결만, 미지정 시 전체.
   * 최신순 limit 개 (default 100).
   */
  listMyFills: authedProcedure
    .input(
      z
        .object({
          accountId: AccountIdField.optional(),
          pdno: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      const pdno = input?.pdno;
      const limit = input?.limit ?? 100;
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
    }),

  /**
   * 선택 주문 일괄 취소 — accountId 명시 필수. 호가창 UI에서 호출.
   */
  cancelMany: authedProcedure
    .input(z.object({ odnos: z.array(z.string()).min(1).max(50), accountId: AccountIdField }))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const rows = ctx.db
        .select()
        .from(orders)
        .where(and(inArray(orders.odno, input.odnos), eq(orders.accountId, accountId)))
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
            .where(and(eq(orders.odno, row.odno), eq(orders.accountId, accountId)))
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
          ctx.db
            .update(orders)
            .set({ status: 'CANCELLED' })
            .where(and(eq(orders.odno, row.odno), eq(orders.accountId, accountId)))
            .run();
          if (row.lotId !== null) {
            if (row.side === 'BUY') {
              if (filledQty === 0) {
                ctx.db.delete(lots).where(eq(lots.id, row.lotId)).run();
              } else {
                ctx.db
                  .update(lots)
                  .set({
                    status: 'OPEN',
                    buyPrice: row.price,
                    qty: filledQty,
                    amountKrw: row.price * filledQty,
                  })
                  .where(eq(lots.id, row.lotId))
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
          // NM-001: 수동 일괄 취소된 주문은 자동취소 감시에서도 제거.
          if (ctx.pendingOrderWatcher) {
            const active = ctx.pendingOrderWatcher.listActive();
            for (const entry of active) {
              if (entry.odno === row.odno) {
                ctx.pendingOrderWatcher.cancel({
                  pdno: entry.pdno,
                  side: entry.side,
                  nth: entry.nth,
                });
              }
            }
          }
          results.push({ odno: row.odno, ok: true });
        } else {
          results.push({ odno: row.odno, ok: false, reason: r.error.msg });
        }
      }
      return { results };
    }),
});

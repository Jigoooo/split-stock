import type { OrderAck } from '@shared/contracts';
import { KisOrderAmendRequestSchema, KisOrderRequestSchema } from '@shared/contracts';
import { correctLimitPrice } from '@shared/market-rules';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { BrokerPort } from '../../brokers/ports/broker-port';
import type { Db } from '../../db/client';
import { lots, orders, trades } from '../../db/schema';
import { readPendingCancelConfig, readPriceCorrectionConfig } from '../../db/settings-repo';
import { createPendingBuyLot, linkHighestPendingSellLot } from '../../trading/order-lot-link';
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
          : input.price;
      const correctedInput = { ...input, price: correctedPrice };

      const placeR = await broker.placeOrder({
        side: correctedInput.side,
        symbol: correctedInput.pdno,
        qty: correctedInput.qty,
        price: correctedInput.price,
        kind: correctedInput.division,
      });
      if (placeR.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `주문 실패: ${placeR.error.kind} - ${placeR.error.msg}`,
        });
      }
      const result = { value: toLegacyAck(placeR.value) };
      // PENDING 기록 — orgNo는 정정/취소 시 필수이므로 KIS 응답값을 저장.
      // lot 링크 + orders insert 를 단일 트랜잭션으로 묶어 부분 실패 시 dangling state
      // (KIS 에는 주문이 있지만 lot/orders 가 inconsistent) 방지.
      const now = new Date();
      const linkedLot = ctx.db.transaction((tx) => {
        void tx;
        const lot =
          input.side === 'BUY'
            ? createPendingBuyLot(
                {
                  logger: ctx.logger,
                  lotsRepo: ctx.lotsRepo,
                },
                {
                  accountId,
                  pdno: input.pdno,
                  placedAt: now,
                  price: input.division === 'LIMIT' ? correctedPrice : 0,
                  qty: input.qty,
                  source: 'MANUAL',
                },
              )
            : linkHighestPendingSellLot(
                {
                  logger: ctx.logger,
                  lotsRepo: ctx.lotsRepo,
                },
                {
                  accountId,
                  pdno: input.pdno,
                  qty: input.qty,
                },
              );
        ctx.db
          .insert(orders)
          .values({
            accountId,
            lotId: lot.lotId,
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
        return lot;
      });

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

      // B4: 즉시주문 직후 잔고 즉시 갱신 트리거 — 30초 폴링 사이클 stale 윈도우에서
      // 가용 현금 초과 매수가 일어나는 것을 줄임. 응답 대기는 안 함 (fire-and-forget).
      void ctx.balanceSync?.refresh();

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

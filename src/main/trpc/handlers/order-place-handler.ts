import type { KisOrderRequestSchema } from '@shared/contracts';
import { correctLimitPrice } from '@shared/market-rules';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';
import type { BrokerPort } from '../../brokers/ports/broker-port';
import { orders } from '../../db/schema';
import { readPendingCancelConfig, readPriceCorrectionConfig } from '../../db/settings-repo';
import type { Context } from '../context';
import { requireAccountId } from '../router-helpers';
import {
  assertManualOrderAllowed,
  cancelAcceptedOrderAfterLocalFailure,
  reserveManualBuyLot,
  reserveManualSellLot,
  rollbackManualOrderLot,
  toLegacyAck,
} from './order-router-helpers';

const STOCK_BROKER = 'KIS';

type PlaceCashInput = z.infer<typeof KisOrderRequestSchema> & { accountId: number };

export async function placeCashHandler(ctx: Context, input: PlaceCashInput) {
  const env = ctx.currentEnv;
  if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
  const accountId = requireAccountId(input);
  const broker = ctx.brokerForAccount(accountId);
  if (!broker) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
  }
  await assertManualOrderAllowed({ broker, accountId, pdno: input.pdno, logger: ctx.logger });
  const safety = ctx.safetyRegistry.get(accountId);
  if (!safety.canTrade(input.pdno)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '안전 스위치에 의해 해당 종목 거래가 차단됨',
    });
  }

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
        broker: STOCK_BROKER,
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

  registerPendingManualOrder(ctx, input, result.value, linkedLot, accountId);
  void ctx.currentStateSync?.trigger('trade-event', {
    accountId,
    brokerOrderId: result.value.odno,
    symbol: input.pdno,
  });

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
}

function registerPendingManualOrder(
  ctx: Context,
  input: PlaceCashInput,
  ack: { odno: string; orgNo?: string },
  linkedLot: { nth: number | null },
  accountId: number,
): void {
  const pendingCfg = readPendingCancelConfig(ctx.settingsRepo);
  if (!pendingCfg.enabled || input.division !== 'LIMIT' || !ack.orgNo || !ctx.pendingOrderWatcher) {
    return;
  }
  ctx.pendingOrderWatcher.register({
    pdno: input.pdno,
    side: input.side,
    nth: linkedLot.nth ?? Date.now() % 1_000_000,
    odno: ack.odno,
    orgNo: ack.orgNo,
    qty: input.qty,
    accountId,
  });
}

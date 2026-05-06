import { type BrokerError, makeBrokerError } from '@shared/contracts';
import { correctLimitPrice } from '@shared/market-rules';
import { hasActiveCycle } from '@shared/trading/next-nth';
import type { BrokerPort } from '../brokers/ports/broker-port';
import { orders } from '../db/schema';
import { readPendingCancelConfig, readPriceCorrectionConfig } from '../db/settings-repo';
import { findRecoverableStrategyOrderAck, isUnknownSubmitResult } from './strategy-order-recovery';
import type { WatchOrder } from './watch-engine';
import {
  cancelAcceptedBrokerOrderAfterLocalFailure,
  cancelPendingByOdno,
} from './watch-order-cancel';
import {
  prepareStrategyOrderLot,
  prepareWatchOrderLot,
  rollbackPreparedOrderLot,
} from './watch-order-lots';
import { recordStrategyOrder, seedFirstEntryStrategyIfNeeded } from './watch-order-recording';
import {
  isStrategyOrderError,
  type PreparedOrderLot,
  StrategyOrderError,
  type StrategyOrderExecutionResult,
  type StrategyOrderInput,
  type WatchOrderExecutorDeps,
} from './watch-order-types';

export {
  cancelPendingByOdno,
  isStrategyOrderError,
  StrategyOrderError,
  type StrategyOrderExecutionResult,
  type StrategyOrderInput,
  type WatchOrderExecutorDeps,
};

export async function executeWatchOrder(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
  triggerPrice: number,
): Promise<void> {
  const snapshot = deps.lotsRepo.snapshot(order.accountId, order.pdno);
  if (snapshot.isErr()) {
    throw new Error('차수 스냅샷 조회 실패');
  }
  const activeCycleExists = hasActiveCycle(snapshot.value.lots);
  if ((order.source === 'PREBUY' || order.source === 'CUSTOM') && order.side === 'BUY') {
    if (activeCycleExists) {
      throw new Error('이미 활성 차수가 있어 신규 1차 자동진입을 생략합니다.');
    }
  }

  const broker = deps.getBrokerForAccount(order.accountId);
  if (!broker) throw new Error('자격증명 없음 또는 환경 미선택');

  const safety = deps.safetyRegistry.get(order.accountId);
  if (!safety.canTrade(order.pdno)) {
    throw new Error('안전 스위치에 의해 해당 종목 거래가 차단됨');
  }

  await deps.marketSessionGuard?.assertAutoOrderAllowed({
    accountId: order.accountId,
    pdno: order.pdno,
    side: order.side,
    source: 'WATCH',
  });

  const division = order.orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
  const limitPrice =
    division === 'LIMIT'
      ? correctLimitPrice({
          targetPrice: triggerPrice,
          side: order.side,
          strategy:
            order.side === 'BUY'
              ? readPriceCorrectionConfig(deps.settingsRepo).buy
              : readPriceCorrectionConfig(deps.settingsRepo).sell,
        })
      : 0;
  const qty =
    order.qtyOrAmountMode === 'QTY'
      ? (order.qty ?? 0)
      : Math.floor(
          (order.amountKrw ?? 0) / Math.max(division === 'LIMIT' ? limitPrice : triggerPrice, 1),
        );
  if (qty <= 0) {
    throw new Error('주문 수량이 0주가 되어 주문할 수 없습니다.');
  }
  const estimatedAmountKrw = qty * Math.max(division === 'LIMIT' ? limitPrice : triggerPrice, 1);

  if (order.side === 'BUY') {
    await deps.autoBuyGuard?.assertAutoBuyAllowed({
      accountId: order.accountId,
      amountKrw: estimatedAmountKrw,
      pdno: order.pdno,
      source: 'WATCH',
    });
  }

  const now = new Date();
  const linkedLot = prepareWatchOrderLot(deps, order, {
    division,
    limitPrice,
    now,
    qty,
  });
  let result: Awaited<ReturnType<BrokerPort['placeOrder']>>;
  try {
    result = await broker.placeOrder({
      side: order.side,
      symbol: order.pdno,
      qty,
      price: division === 'LIMIT' ? limitPrice : 0,
      kind: division,
    });
  } catch (cause) {
    rollbackPreparedOrderLot(deps, linkedLot);
    throw cause;
  }
  if (result.isErr()) {
    rollbackPreparedOrderLot(deps, linkedLot);
    throw new Error(`주문 실패: ${result.error.kind} - ${result.error.msg}`);
  }

  try {
    deps.db
      .insert(orders)
      .values({
        broker: broker.brokerId,
        accountId: order.accountId,
        lotId: linkedLot.lotId,
        odno: result.value.brokerOrderId,
        orgNo: result.value.brokerOrgNo ?? null,
        pdno: order.pdno,
        side: order.side,
        division,
        qty,
        price: division === 'LIMIT' ? limitPrice : 0,
        status: 'PENDING',
        placedAt: now,
      })
      .run();
  } catch (cause) {
    rollbackPreparedOrderLot(deps, linkedLot);
    await cancelAcceptedBrokerOrderAfterLocalFailure(deps, broker, result.value, {
      division,
      pdno: order.pdno,
    });
    throw new Error(
      `자동감시 주문 로컬 기록 실패 — broker 주문 취소를 요청했습니다: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  seedFirstEntryStrategyIfNeeded(deps, order);
  logWatchOrderSubmitted(deps, order, linkedLot, { qty, triggerPrice });
  registerPendingWatchOrder(deps, order, linkedLot, {
    brokerOrderId: result.value.brokerOrderId,
    brokerOrgNo: result.value.brokerOrgNo,
    division,
    qty,
  });
}

export async function executeStrategyOrder(
  deps: WatchOrderExecutorDeps,
  input: StrategyOrderInput,
): Promise<StrategyOrderExecutionResult> {
  const broker = deps.getBrokerForAccount(input.accountId);
  if (!broker) throw new Error('자격증명 없음 또는 환경 미선택');

  const attemptedAt = new Date();
  if (input.reconcileOnly === true) {
    return executeReconcileOnlyStrategyOrder(deps, broker, input, attemptedAt);
  }

  const safety = deps.safetyRegistry.get(input.accountId);
  if (!safety.canTrade(input.pdno)) {
    throw new Error('안전 스위치에 의해 해당 종목 거래가 차단됨');
  }

  if (input.side === 'BUY') {
    await deps.autoBuyGuard?.assertAutoBuyAllowed({
      accountId: input.accountId,
      amountKrw: input.qty * Math.max(input.price, 1),
      pdno: input.pdno,
      source: 'STRATEGY',
    });
  }

  const preparedLot = prepareStrategyOrderLot(deps, input, attemptedAt);
  let result: Awaited<ReturnType<BrokerPort['placeOrder']>>;
  try {
    result = await broker.placeOrder({
      side: input.side,
      symbol: input.pdno,
      qty: input.qty,
      price: input.division === 'LIMIT' ? input.price : 0,
      kind: input.division,
    });
  } catch (cause) {
    rollbackPreparedOrderLot(deps, preparedLot);
    throw cause;
  }
  if (result.isErr()) {
    return handleRejectedStrategyOrder(deps, broker, input, attemptedAt, preparedLot, result.error);
  }

  try {
    recordStrategyOrder(deps, input, result.value, attemptedAt, preparedLot, {
      reconciled: false,
      broker: broker.brokerId,
    });
  } catch (cause) {
    rollbackPreparedOrderLot(deps, preparedLot);
    await cancelAcceptedBrokerOrderAfterLocalFailure(deps, broker, result.value, {
      division: input.division,
      pdno: input.pdno,
    });
    throw new Error(
      `전략 주문 로컬 기록 실패 — broker 주문 취소를 요청했습니다: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  return { brokerOrderId: result.value.brokerOrderId, reconciled: false };
}

async function executeReconcileOnlyStrategyOrder(
  deps: WatchOrderExecutorDeps,
  broker: BrokerPort,
  input: StrategyOrderInput,
  attemptedAt: Date,
): Promise<StrategyOrderExecutionResult> {
  const recoverableAck = await findRecoverableStrategyOrderAck(deps, broker, input, attemptedAt);
  if (recoverableAck === null) {
    throw new StrategyOrderError(
      input,
      makeBrokerError({
        brokerId: broker.brokerId,
        kind: 'UNKNOWN',
        msg: '주문 접수 여부를 아직 확인하지 못했습니다.',
      }),
      attemptedAt,
    );
  }

  let preparedLot: PreparedOrderLot | null = null;
  try {
    preparedLot = prepareStrategyOrderLot(deps, input, attemptedAt);
    recordStrategyOrder(deps, input, recoverableAck, attemptedAt, preparedLot, {
      reconciled: true,
      broker: broker.brokerId,
    });
  } catch (cause) {
    if (preparedLot !== null) rollbackPreparedOrderLot(deps, preparedLot);
    await cancelAcceptedBrokerOrderAfterLocalFailure(deps, broker, recoverableAck, {
      division: input.division,
      pdno: input.pdno,
    });
    throw cause;
  }
  return { brokerOrderId: recoverableAck.brokerOrderId, reconciled: true };
}

async function handleRejectedStrategyOrder(
  deps: WatchOrderExecutorDeps,
  broker: BrokerPort,
  input: StrategyOrderInput,
  attemptedAt: Date,
  preparedLot: PreparedOrderLot,
  brokerError: BrokerError,
): Promise<StrategyOrderExecutionResult> {
  if (isUnknownSubmitResult(brokerError.kind)) {
    const recoverableAck = await findRecoverableStrategyOrderAck(deps, broker, input, attemptedAt);
    if (recoverableAck !== null) {
      try {
        recordStrategyOrder(deps, input, recoverableAck, attemptedAt, preparedLot, {
          reconciled: true,
          broker: broker.brokerId,
        });
      } catch (cause) {
        rollbackPreparedOrderLot(deps, preparedLot);
        await cancelAcceptedBrokerOrderAfterLocalFailure(deps, broker, recoverableAck, {
          division: input.division,
          pdno: input.pdno,
        });
        throw cause;
      }
      return { brokerOrderId: recoverableAck.brokerOrderId, reconciled: true };
    }
  }
  rollbackPreparedOrderLot(deps, preparedLot);
  throw new StrategyOrderError(input, brokerError, attemptedAt);
}

function logWatchOrderSubmitted(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
  linkedLot: PreparedOrderLot,
  input: { qty: number; triggerPrice: number },
): void {
  deps.logger.log({
    level: 'INFO',
    category: 'WATCH',
    message: 'watch.order-submitted',
    payload: {
      accountId: order.accountId,
      pdno: order.pdno,
      side: order.side,
      source: order.source,
      nth: linkedLot.nth ?? order.nth ?? null,
      qty: input.qty,
      triggerPrice: input.triggerPrice,
    },
  });
}

function registerPendingWatchOrder(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
  linkedLot: PreparedOrderLot,
  input: {
    brokerOrderId: string;
    brokerOrgNo: string | undefined;
    division: 'LIMIT' | 'MARKET';
    qty: number;
  },
): void {
  const pendingCfg = readPendingCancelConfig(deps.settingsRepo);
  if (
    !pendingCfg.enabled ||
    input.division !== 'LIMIT' ||
    !input.brokerOrgNo ||
    !deps.pendingOrderWatcher
  ) {
    return;
  }
  deps.pendingOrderWatcher.register({
    pdno: order.pdno,
    side: order.side,
    nth: linkedLot.nth ?? order.nth ?? Date.now() % 1_000_000,
    odno: input.brokerOrderId,
    orgNo: input.brokerOrgNo,
    qty: input.qty,
    accountId: order.accountId,
  });
}

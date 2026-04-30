import type { BrokerError, BrokerErrorKind, DailyExecution, OrderAck } from '@shared/contracts';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { StrategyOrderInput, WatchOrderExecutorDeps } from './watch-order-types';

export async function findRecoverableStrategyOrderAck(
  deps: WatchOrderExecutorDeps,
  broker: BrokerPort,
  input: StrategyOrderInput,
  attemptedAt: Date,
): Promise<OrderAck | null> {
  const oneMinuteBefore = new Date(attemptedAt.getTime() - 60_000);
  const twoMinutesAfter = new Date(attemptedAt.getTime() + 120_000);
  const remote = await listRecoveryExecutions(broker, {
    from: oneMinuteBefore,
    to: twoMinutesAfter,
    symbol: input.pdno,
    side: input.side,
  });
  if (remote.error) {
    deps.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'strategy.order-reconcile.lookup-failed',
      payload: {
        accountId: input.accountId,
        brokerId: broker.brokerId,
        kind: remote.error.kind,
        msg: remote.error.msg,
        nth: input.nth,
        pdno: input.pdno,
        side: input.side,
      },
    });
    return null;
  }

  const price = input.division === 'LIMIT' ? input.price : 0;
  const match = remote.value.find((entry) => isMatchingRecoveredOrder(entry, input, price));
  if (!match) return null;

  deps.logger.log({
    level: 'WARN',
    category: 'ORDER',
    message: 'strategy.order-reconcile.matched',
    payload: {
      accountId: input.accountId,
      brokerId: broker.brokerId,
      brokerOrderId: match.brokerOrderId,
      nth: input.nth,
      pdno: input.pdno,
      side: input.side,
    },
  });

  return {
    brokerOrderId: match.brokerOrderId,
    ...(match.brokerOrgNo !== undefined && { brokerOrgNo: match.brokerOrgNo }),
    acceptedAt: match.orderedAt,
  };
}

async function listRecoveryExecutions(
  broker: BrokerPort,
  params: {
    from: Date;
    side: 'BUY' | 'SELL';
    symbol: string;
    to: Date;
  },
): Promise<{ value: DailyExecution[]; error: BrokerError | null }> {
  const all = new Map<string, DailyExecution>();
  let firstError: BrokerError | null = null;

  for (const filledOnly of [false, true] as const) {
    const result = await broker.listDailyExecutions({
      ...params,
      filledOnly,
    });
    if (result.isErr()) {
      firstError ??= result.error;
      continue;
    }
    for (const entry of result.value) {
      all.set(entry.brokerOrderId, entry);
    }
  }

  if (all.size === 0 && firstError !== null) {
    return { value: [], error: firstError };
  }
  return { value: Array.from(all.values()), error: null };
}

function isMatchingRecoveredOrder(
  entry: DailyExecution,
  input: StrategyOrderInput,
  price: number,
): boolean {
  if (entry.symbol !== input.pdno) return false;
  if (entry.side !== input.side) return false;
  if (entry.orderQty !== input.qty) return false;
  if (entry.cancelled) return false;
  if (input.division === 'LIMIT' && entry.orderPrice !== price) return false;
  return entry.remainingQty > 0 || entry.totalFilledQty > 0;
}

export function isUnknownSubmitResult(kind: BrokerErrorKind): boolean {
  return kind === 'NETWORK' || kind === 'UNKNOWN';
}

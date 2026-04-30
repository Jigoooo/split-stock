import type { DailyExecution } from '@shared/contracts';

export type OrderStatus = 'PENDING' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type OrderDivision = 'LIMIT' | 'MARKET';

export interface ReconcileDecision {
  nextStatus: OrderStatus;
  totalFilledQty: number;
  deltaFilledQty: number;
  remainingQty: number;
  executionPrice: number;
}

export interface PendingSnapshotContext {
  serverPendingPresent: boolean;
  now: Date;
  placedAt: Date;
  graceMs: number;
}

export function resolveManualOrderDecision(input: {
  localStatus: 'PENDING' | 'PARTIAL';
  orderQty: number;
  localFilledQty: number;
  localPrice: number;
  division?: OrderDivision;
  remote: DailyExecution;
}): ReconcileDecision | null {
  const totalFilledQty = Math.min(input.orderQty, Math.max(0, input.remote.totalFilledQty));
  const deltaFilledQty = Math.max(0, totalFilledQty - input.localFilledQty);
  const remainingQty =
    input.remote.remainingQty > 0
      ? input.remote.remainingQty
      : Math.max(0, input.orderQty - totalFilledQty);
  const division = input.division ?? 'LIMIT';
  const executionPrice = resolveExecutionPrice({
    division,
    localPrice: input.localPrice,
    remoteOrderPrice: input.remote.orderPrice,
    remoteAvgFillPrice: input.remote.avgFillPrice,
    totalFilledQty,
  });
  if (executionPrice === null) return null;

  if (totalFilledQty > 0) {
    const nextStatus: OrderStatus = input.remote.cancelled
      ? remainingQty > 0
        ? 'CANCELLED'
        : 'FILLED'
      : remainingQty > 0
        ? 'PARTIAL'
        : 'FILLED';
    if (deltaFilledQty === 0 && nextStatus === input.localStatus) return null;
    return { nextStatus, totalFilledQty, deltaFilledQty, remainingQty, executionPrice };
  }

  if (input.remote.rejectedQty > 0) {
    return {
      nextStatus: 'REJECTED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: input.orderQty,
      executionPrice,
    };
  }

  if (input.remote.cancelled) {
    return {
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty,
      executionPrice,
    };
  }

  return null;
}

export function resolveServerPendingAbsenceDecision(input: {
  localFilledQty: number;
  orderQty: number;
  localPrice: number;
  localExecutionPrice?: number;
  division?: OrderDivision;
  context: PendingSnapshotContext;
}): ReconcileDecision | null {
  if (input.context.serverPendingPresent) return null;
  if (input.context.now.getTime() - input.context.placedAt.getTime() < input.context.graceMs) {
    return null;
  }

  const division = input.division ?? 'LIMIT';
  const executionPrice =
    input.localFilledQty > 0
      ? division === 'MARKET'
        ? input.localExecutionPrice && input.localExecutionPrice > 0
          ? input.localExecutionPrice
          : null
        : input.localExecutionPrice && input.localExecutionPrice > 0
          ? input.localExecutionPrice
          : input.localPrice
      : division === 'MARKET'
        ? 0
        : input.localPrice;
  if (executionPrice === null) return null;

  return {
    nextStatus: input.localFilledQty >= input.orderQty ? 'FILLED' : 'CANCELLED',
    totalFilledQty: input.localFilledQty,
    deltaFilledQty: 0,
    remainingQty: Math.max(0, input.orderQty - input.localFilledQty),
    executionPrice,
  };
}

export function resolveMarketFillWithoutPrice(input: {
  division: string;
  localFilledQty: number;
  remote: DailyExecution;
}): boolean {
  return (
    input.division === 'MARKET' &&
    input.remote.totalFilledQty > input.localFilledQty &&
    input.remote.avgFillPrice <= 0
  );
}

function resolveExecutionPrice(input: {
  division: OrderDivision;
  localPrice: number;
  remoteOrderPrice: number;
  remoteAvgFillPrice: number;
  totalFilledQty: number;
}): number | null {
  if (input.remoteAvgFillPrice > 0) return input.remoteAvgFillPrice;
  if (input.division === 'MARKET') {
    return input.totalFilledQty > 0 ? null : 0;
  }
  if (input.remoteOrderPrice > 0) return input.remoteOrderPrice;
  return input.localPrice;
}

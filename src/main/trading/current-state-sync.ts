import { realTimer, type Timer } from '../brokers/core/types';
import type { EventLogger } from '../logging/event-logger';
import type { BalanceSync } from './balance-sync';
import type { ManualOrderReconciler } from './manual-order-reconciler';

export type LotSyncStatus = 'IN_SYNC' | 'RECONCILING' | 'MISMATCH';
export const SELL_SETTLEMENT_GRACE_MS = 30_000;

export interface LotSyncMismatch {
  pdno: string;
  kisQty: number;
  lotQty: number;
  reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
}

export interface LotSyncState {
  syncStatus: LotSyncStatus;
  mismatches: LotSyncMismatch[];
  pendingMismatches: LotSyncMismatch[];
}

export interface CurrentStateSyncOptions {
  balanceSync: Pick<BalanceSync, 'refresh'>;
  logger: EventLogger;
  manualOrderReconciler: Pick<ManualOrderReconciler, 'poll'>;
  onRefreshed?: (() => void) | undefined;
  timer?: Timer;
  brokerEventDebounceMs?: number;
}

export type CurrentStateSyncReason =
  | 'startup'
  | 'account-switch'
  | 'env-switch'
  | 'trade-event'
  | 'manual';

export interface CurrentStateSyncTarget {
  accountId?: number;
  brokerOrderId?: string;
  symbol?: string;
}

export function buildLotSyncState(input: {
  lotsByPdno: Record<string, Array<{ qty: number; status: string }>>;
  positions: Array<{ code: string; qty: number }>;
  recentSellOrderPdnos?: ReadonlySet<string>;
}): LotSyncState {
  const kisQtyByPdno = new Map<string, number>();
  for (const position of input.positions) {
    if (position.qty <= 0) continue;
    kisQtyByPdno.set(position.code, position.qty);
  }

  const lotQtyByPdno = new Map<string, number>();
  const hasSellingLot = new Set<string>();
  for (const [pdno, lots] of Object.entries(input.lotsByPdno)) {
    // BUYING lot 은 KIS 잔고에 아직 반영되지 않은 미체결 매수 → mismatch 비교에서 완전 제외.
    // (Q-C: BUYING 차수가 lot 합산에 들어가면 KIS qty(0) vs lotQty(N) 가 STALE_LOTS 로 오인됨)
    const qty = lots
      .filter((lot) => lot.status !== 'BUYING')
      .reduce((sum, lot) => sum + lot.qty, 0);
    if (qty > 0) lotQtyByPdno.set(pdno, qty);
    if (lots.some((lot) => lot.status === 'SELLING')) hasSellingLot.add(pdno);
  }

  const pdnos = new Set([...kisQtyByPdno.keys(), ...lotQtyByPdno.keys()]);
  const mismatches: LotSyncMismatch[] = [];
  const pendingMismatches: LotSyncMismatch[] = [];
  for (const pdno of pdnos) {
    const kisQty = kisQtyByPdno.get(pdno) ?? 0;
    const lotQty = lotQtyByPdno.get(pdno) ?? 0;
    if (kisQty === lotQty) continue;
    const mismatch: LotSyncMismatch = {
      pdno,
      kisQty,
      lotQty,
      reason: kisQty > 0 && lotQty === 0 ? 'NO_LOTS' : kisQty === 0 ? 'STALE_LOTS' : 'QTY_MISMATCH',
    };
    if (hasSellingLot.has(pdno) || input.recentSellOrderPdnos?.has(pdno)) {
      pendingMismatches.push(mismatch);
    } else {
      mismatches.push(mismatch);
    }
  }
  mismatches.sort((a, b) => a.pdno.localeCompare(b.pdno));
  pendingMismatches.sort((a, b) => a.pdno.localeCompare(b.pdno));
  return {
    syncStatus:
      mismatches.length > 0 ? 'MISMATCH' : pendingMismatches.length > 0 ? 'RECONCILING' : 'IN_SYNC',
    mismatches,
    pendingMismatches,
  };
}

export function buildLotSyncMismatches(input: {
  lotsByPdno: Record<string, Array<{ qty: number; status: string }>>;
  positions: Array<{ code: string; qty: number }>;
  recentSellOrderPdnos?: ReadonlySet<string>;
}): LotSyncMismatch[] {
  return buildLotSyncState(input).mismatches;
}

/**
 * 현 상태 수렴 트리거.
 * - 주문/체결 상태를 먼저 보정
 * - 그 다음 잔고 pull로 broker 기준 괴리를 감지/보강
 */
export class CurrentStateSync {
  private running = false;
  private readonly timer: Timer;
  private readonly brokerEventDebounceMs: number;
  private debounceHandle: { clear: () => void } | null = null;
  private pendingBrokerTarget: CurrentStateSyncTarget | null = null;

  constructor(private readonly opts: CurrentStateSyncOptions) {
    this.timer = opts.timer ?? realTimer;
    this.brokerEventDebounceMs = opts.brokerEventDebounceMs ?? 500;
  }

  trigger(reason: CurrentStateSyncReason, target?: CurrentStateSyncTarget): { started: boolean } {
    if (this.running) {
      if (target) this.pendingBrokerTarget = mergeSyncTarget(this.pendingBrokerTarget, target);
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.skip-already-running',
        payload: { reason, queued: target !== undefined },
      });
      return { started: false };
    }

    void this.refresh(reason, target).catch((error: unknown) => {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'BALANCE',
        message: 'current-state-sync.background-failed',
        payload: {
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
    return { started: true };
  }

  enqueueBrokerEvent(target: CurrentStateSyncTarget): { queued: boolean } {
    this.pendingBrokerTarget = mergeSyncTarget(this.pendingBrokerTarget, target);
    if (this.debounceHandle) return { queued: true };
    this.debounceHandle = this.timer.setTimeout(() => {
      this.debounceHandle = null;
      const next = this.consumePendingTarget();
      if (next) this.trigger('trade-event', next);
    }, this.brokerEventDebounceMs);
    return { queued: true };
  }

  async refresh(reason: CurrentStateSyncReason, target?: CurrentStateSyncTarget): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.start',
        payload: { reason, target },
      });
      const manualStartedAt = Date.now();
      await this.opts.manualOrderReconciler.poll(target);
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.manual-orders.done',
        payload: {
          reason,
          target,
          durationMs: Date.now() - manualStartedAt,
        },
      });
      const balanceStartedAt = Date.now();
      await this.opts.balanceSync.refresh();
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.balance.done',
        payload: {
          reason,
          target,
          durationMs: Date.now() - balanceStartedAt,
        },
      });
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.refreshed',
        payload: {
          reason,
          target,
          durationMs: Date.now() - startedAt,
        },
      });
      this.opts.onRefreshed?.();
    } catch (error) {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'BALANCE',
        message: 'current-state-sync.failed',
        payload: {
          reason,
          target,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      this.running = false;
      const next = this.consumePendingTarget();
      if (next) {
        void this.refresh('trade-event', next).catch((error: unknown) => {
          this.opts.logger.log({
            level: 'ERROR',
            category: 'BALANCE',
            message: 'current-state-sync.follow-up-failed',
            payload: {
              target: next,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });
      }
    }
  }

  private consumePendingTarget(): CurrentStateSyncTarget | null {
    const target = this.pendingBrokerTarget;
    this.pendingBrokerTarget = null;
    return target;
  }
}

function mergeSyncTarget(
  prev: CurrentStateSyncTarget | null,
  next: CurrentStateSyncTarget,
): CurrentStateSyncTarget {
  if (!prev) return next;
  return {
    ...(prev.accountId === next.accountId && prev.accountId !== undefined
      ? { accountId: prev.accountId }
      : {}),
    ...(prev.brokerOrderId === next.brokerOrderId && prev.brokerOrderId !== undefined
      ? { brokerOrderId: prev.brokerOrderId }
      : {}),
    ...(prev.symbol === next.symbol && prev.symbol !== undefined ? { symbol: prev.symbol } : {}),
  };
}

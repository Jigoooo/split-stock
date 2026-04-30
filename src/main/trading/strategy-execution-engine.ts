import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import { realTimer, type Timer } from '../brokers/core/types';
import { isAutoOrderBlockedError } from './auto-order-errors';
import { evaluate } from './fsm';
import { StrategyRetryRuntime } from './strategy-execution-retry';
import type { StrategyExecutionEngineOptions } from './strategy-execution-types';
import { resolveStrategyProfile } from './strategy-profile-resolver';

export type {
  StrategyExecutionEngineOptions,
  StrategyExecutionOrderResult,
} from './strategy-execution-types';

export class StrategyExecutionEngine {
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly inFlightPdnos = new Set<string>();
  private readonly timer: Timer;
  private readonly retryRuntime: StrategyRetryRuntime;

  constructor(private readonly opts: StrategyExecutionEngineOptions) {
    this.timer = opts.timer ?? realTimer;
    this.retryRuntime = new StrategyRetryRuntime({
      autoOrderRetryCooldownMs: opts.autoOrderRetryCooldownMs,
      evaluateLatest: (pdno) => this.evaluateLatest(pdno),
      getActiveAccountId: opts.getActiveAccountId,
      logger: opts.logger,
      onAutoOrderRetryScheduled: opts.onAutoOrderRetryScheduled,
      safetyRegistry: opts.safetyRegistry,
      timer: this.timer,
    });
  }

  refreshTrackedSymbols(): void {
    const accountId = this.opts.getActiveAccountId();
    if (accountId === null) {
      this.replaceTracked([]);
      return;
    }
    const rows = this.opts.lotsRepo.listRows(accountId);
    if (rows.isErr()) {
      this.opts.logger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'strategy-engine.refresh.failed',
        payload: { accountId, reason: rows.error.kind },
      });
      return;
    }

    const tracked = new Set<string>();
    for (const row of rows.value) {
      if (!ACTIVE_CYCLE_STATUSES.includes(row.status as ActiveCycleStatus)) continue;
      tracked.add(row.pdno);
    }
    this.replaceTracked(Array.from(tracked).sort((a, b) => a.localeCompare(b)));
  }

  evaluateLatest(pdno: string): boolean {
    const tick = this.opts.bus.getLatestTick(pdno);
    if (!tick) return false;
    void this.onTick(pdno, tick.price).catch((error) => {
      this.retryRuntime.handleTickFailure(pdno, tick.price, error);
    });
    return true;
  }

  evaluateLatestForTracked(): number {
    let requested = 0;
    for (const pdno of this.unsubscribers.keys()) {
      if (this.evaluateLatest(pdno)) requested += 1;
    }
    return requested;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
    this.retryRuntime.dispose();
    this.opts.onTrackedPdnosChanged?.([]);
  }

  private replaceTracked(pdnos: string[]): void {
    const next = new Set(pdnos);
    for (const [pdno, unsubscribe] of this.unsubscribers.entries()) {
      if (next.has(pdno)) continue;
      unsubscribe();
      this.unsubscribers.delete(pdno);
    }
    for (const pdno of next) {
      if (this.unsubscribers.has(pdno)) continue;
      this.unsubscribers.set(
        pdno,
        this.opts.bus.subscribeTick(pdno, (tick) => {
          void this.onTick(pdno, tick.price).catch((error) => {
            this.retryRuntime.handleTickFailure(pdno, tick.price, error);
          });
        }),
      );
    }
    this.opts.onTrackedPdnosChanged?.(
      Array.from(this.unsubscribers.keys()).sort((a, b) => a.localeCompare(b)),
    );
  }

  private async onTick(pdno: string, price: number): Promise<void> {
    const accountId = this.opts.getActiveAccountId();
    if (accountId === null) return;
    if (this.inFlightPdnos.has(pdno)) return;
    if (!this.opts.safetyRegistry.get(accountId).canTrade(pdno)) return;

    const profile = resolveStrategyProfile(this.opts.strategyRepo, accountId, pdno);
    if (!profile) return;

    const snapshot = this.opts.lotsRepo.snapshot(accountId, pdno);
    if (snapshot.isErr()) return;
    const activeLots = snapshot.value.lots.filter((lot) =>
      ACTIVE_CYCLE_STATUSES.includes(lot.status as ActiveCycleStatus),
    );
    if (activeLots.length === 0) return;

    const orders = evaluate(
      price,
      {
        pdno,
        lots: activeLots,
      },
      {
        pdno,
        maxStages: profile.maxStages,
        buyRules: profile.buyRules,
        sellRules: profile.sellRules,
      },
    );
    const actionableOrders = orders
      .filter((order) => (order.kind === 'BUY' ? profile.autoBuyEnabled : profile.autoSellEnabled))
      .filter((order) => !this.retryRuntime.isOrderRetryCoolingDown(accountId, order));
    if (actionableOrders.length === 0) return;

    if (
      this.opts.inFlightCoordinator &&
      !this.opts.inFlightCoordinator.tryAcquire(accountId, pdno)
    ) {
      return;
    }
    this.inFlightPdnos.add(pdno);
    try {
      const guardOrder = actionableOrders[0];
      if (guardOrder && this.opts.marketSessionGuard) {
        try {
          await this.opts.marketSessionGuard.assertAutoOrderAllowed({
            accountId,
            pdno,
            side: guardOrder.kind,
            source: 'STRATEGY',
          });
        } catch (error) {
          if (isAutoOrderBlockedError(error)) {
            this.retryRuntime.handleOrderBlocked({
              accountId,
              code: error.code,
              nth: guardOrder.nth,
              pdno,
              price,
              qty: guardOrder.qty,
              reason: error.message,
              side: guardOrder.kind,
              triggerReason: guardOrder.kind === 'BUY' ? 'DROP_BUY' : 'PROFIT_SELL',
            });
            return;
          }
          throw error;
        }
      }

      this.opts.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'strategy-engine.orders-generated',
        payload: {
          accountId,
          orderCount: actionableOrders.length,
          pdno,
          price,
        },
      });

      for (const order of actionableOrders) {
        const triggerReason = order.kind === 'BUY' ? 'DROP_BUY' : 'PROFIT_SELL';
        try {
          const reconcileErrorKind = this.retryRuntime.retryErrorKind(accountId, order);
          const result = await this.opts.executeOrder({
            accountId,
            division: order.kind === 'BUY' ? profile.autoBuyOrderType : profile.autoSellOrderType,
            nth: order.nth,
            pdno: order.pdno,
            price: order.price,
            qty: order.qty,
            reconcileOnly: this.retryRuntime.isRetryReconcileOnly(accountId, order),
            side: order.kind,
            triggerReason,
          });
          if (result?.reconciled) {
            this.opts.onAutoOrderRetryScheduled?.({
              accountId,
              attempt: this.retryRuntime.peekNextAttempt(
                accountId,
                order.pdno,
                order.kind,
                order.nth,
              ),
              ...(reconcileErrorKind !== undefined && { errorKind: reconcileErrorKind }),
              failureType: 'FAILED',
              nth: order.nth,
              occurredAt: this.timer.now(),
              pdno: order.pdno,
              price: order.price,
              qty: order.qty,
              reason: '기존 주문 접수를 확인했습니다.',
              retryAfterMs: null,
              side: order.kind,
              status: 'RECONCILED',
              triggerReason,
            });
          }
          this.retryRuntime.clearOrderRetry(accountId, order);
        } catch (error) {
          if (isAutoOrderBlockedError(error)) {
            this.retryRuntime.handleOrderBlocked({
              accountId,
              code: error.code,
              nth: order.nth,
              pdno: order.pdno,
              price,
              qty: order.qty,
              reason: error.message,
              side: order.kind,
              triggerReason,
            });
            return;
          }
          this.retryRuntime.handleOrderFailure({
            accountId,
            error,
            nth: order.nth,
            pdno: order.pdno,
            price,
            qty: order.qty,
            side: order.kind,
            triggerReason,
          });
          return;
        }
      }
    } finally {
      this.inFlightPdnos.delete(pdno);
      this.opts.inFlightCoordinator?.release(accountId, pdno);
    }
  }
}

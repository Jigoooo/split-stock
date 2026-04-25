import type { StrategyProfile } from '@shared/contracts';
import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { SafetyStateRegistry } from '../safety/safety-state';
import { isAutoOrderBlockedError } from './auto-order-errors';
import { evaluate } from './fsm';
import type { InFlightCoordinator } from './in-flight-coordinator';
import type { LotsRepo } from './lots-repo';
import type { AutoOrderMarketGuard } from './market-session-guard';
import type { StrategyRepo } from './strategy-repo';

export interface StrategyExecutionEngineOptions {
  bus: FeedBus;
  logger: EventLogger;
  lotsRepo: LotsRepo;
  strategyRepo: StrategyRepo;
  safetyRegistry: SafetyStateRegistry;
  getActiveAccountId: () => number | null;
  executeOrder: (input: {
    accountId: number;
    division: 'LIMIT' | 'MARKET';
    nth: number;
    pdno: string;
    price: number;
    qty: number;
    side: 'BUY' | 'SELL';
    triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  }) => Promise<void>;
  marketSessionGuard?: AutoOrderMarketGuard;
  onTrackedPdnosChanged?: (pdnos: string[]) => void;
  /** WatchEngine 등 다른 source 와 cross-dedupe 위한 공유 coordinator (선택). */
  inFlightCoordinator?: InFlightCoordinator;
}

export class StrategyExecutionEngine {
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly inFlightPdnos = new Set<string>();
  private readonly blockedLogLastAt = new Map<string, number>();

  constructor(private readonly opts: StrategyExecutionEngineOptions) {}

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

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
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
            this.handleTickFailure(pdno, tick.price, error);
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
    const actionableOrders = orders.filter((order) =>
      order.kind === 'BUY' ? profile.autoBuyEnabled : profile.autoSellEnabled,
    );
    if (actionableOrders.length === 0) return;

    // cross-source dedupe: WatchEngine 이 같은 (accountId, pdno) 으로 동시에 fire 하지 못하도록.
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
            this.handleOrderBlocked({
              accountId,
              code: error.code,
              nth: guardOrder.nth,
              pdno,
              price,
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
          await this.opts.executeOrder({
            accountId,
            division: order.kind === 'BUY' ? profile.autoBuyOrderType : profile.autoSellOrderType,
            nth: order.nth,
            pdno: order.pdno,
            price: order.price,
            qty: order.qty,
            side: order.kind,
            triggerReason,
          });
        } catch (error) {
          if (isAutoOrderBlockedError(error)) {
            this.handleOrderBlocked({
              accountId,
              code: error.code,
              nth: order.nth,
              pdno: order.pdno,
              price,
              reason: error.message,
              side: order.kind,
              triggerReason,
            });
            return;
          }
          this.handleOrderFailure({
            accountId,
            error,
            nth: order.nth,
            pdno: order.pdno,
            price,
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

  private handleOrderFailure(input: {
    accountId: number;
    error: unknown;
    nth: number;
    pdno: string;
    price: number;
    side: 'BUY' | 'SELL';
    triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  }): void {
    const reason = describeUnknownError(input.error);
    this.opts.logger.log({
      level: 'ERROR',
      category: 'FSM',
      message: 'strategy-engine.order-failed',
      payload: {
        accountId: input.accountId,
        nth: input.nth,
        pdno: input.pdno,
        price: input.price,
        reason,
        side: input.side,
        triggerReason: input.triggerReason,
      },
    });
    this.opts.safetyRegistry.get(input.accountId).recordError(reason);
  }

  private handleOrderBlocked(input: {
    accountId: number;
    code: string;
    nth: number;
    pdno: string;
    price: number;
    reason: string;
    side: 'BUY' | 'SELL';
    triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  }): void {
    const logKey = `${input.accountId}:${input.pdno}:${input.code}:${input.side}`;
    const now = Date.now();
    const lastAt = this.blockedLogLastAt.get(logKey) ?? 0;
    if (now - lastAt < 60_000) return;
    this.blockedLogLastAt.set(logKey, now);
    this.opts.logger.log({
      level: 'WARN',
      category: 'FSM',
      message: 'strategy-engine.order-blocked',
      payload: {
        accountId: input.accountId,
        code: input.code,
        nth: input.nth,
        pdno: input.pdno,
        price: input.price,
        reason: input.reason,
        side: input.side,
        triggerReason: input.triggerReason,
      },
    });
  }

  private handleTickFailure(pdno: string, price: number, error: unknown): void {
    const accountId = this.opts.getActiveAccountId();
    const reason = describeUnknownError(error);
    this.opts.logger.log({
      level: 'ERROR',
      category: 'FSM',
      message: 'strategy-engine.tick-failed',
      payload: {
        accountId,
        pdno,
        price,
        reason,
      },
    });
    if (accountId !== null) {
      this.opts.safetyRegistry.get(accountId).recordError(reason);
    }
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function resolveStrategyProfile(
  repo: StrategyRepo,
  accountId: number,
  pdno: string,
): StrategyProfile | null {
  const active = repo.getActive(accountId, pdno);
  if (active.isOk() && active.value !== null) return active.value;
  const global = repo.getActive(accountId, null);
  if (global.isOk() && global.value !== null) return global.value;
  return null;
}

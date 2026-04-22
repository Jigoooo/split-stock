import type { StrategyProfile } from '@shared/contracts';
import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { SafetyStateRegistry } from '../safety/safety-state';
import { evaluate } from './fsm';
import type { LotsRepo } from './lots-repo';
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
  onTrackedPdnosChanged?: (pdnos: string[]) => void;
}

export class StrategyExecutionEngine {
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly inFlightPdnos = new Set<string>();

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
          void this.onTick(pdno, tick.price);
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
        totalAmountKrw: profile.totalAmountKrw,
        maxStages: profile.maxStages,
        dropPct: profile.dropPct,
        profitPct: profile.profitPct,
      },
    );
    const actionableOrders = orders.filter((order) =>
      order.kind === 'BUY' ? profile.autoBuyEnabled : profile.autoSellEnabled,
    );
    if (actionableOrders.length === 0) return;

    this.inFlightPdnos.add(pdno);
    try {
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
        await this.opts.executeOrder({
          accountId,
          division: order.kind === 'BUY' ? profile.autoBuyOrderType : profile.autoSellOrderType,
          nth: order.nth,
          pdno: order.pdno,
          price: order.price,
          qty: order.qty,
          side: order.kind,
          triggerReason: order.kind === 'BUY' ? 'DROP_BUY' : 'PROFIT_SELL',
        });
      }
    } finally {
      this.inFlightPdnos.delete(pdno);
    }
  }
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

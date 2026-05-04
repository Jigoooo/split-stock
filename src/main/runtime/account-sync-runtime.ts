import type { TradeExecutionEvent } from '@shared/contracts';
import type { Db } from '../db/client';
import type { EventLogger } from '../logging/event-logger';
import { BalanceSync } from '../trading/balance-sync';
import { CurrentStateSync } from '../trading/current-state-sync';
import type { LotsRepo } from '../trading/lots-repo';
import { ManualOrderReconciler } from '../trading/manual-order-reconciler';
import type { StrategyExecutionEngine } from '../trading/strategy-execution-engine';
import type { createContextFactory } from '../trpc/context';

type RuntimeContextFactory = ReturnType<typeof createContextFactory>;

export interface AccountSyncRuntime {
  balanceSync: BalanceSync;
  manualOrderReconciler: ManualOrderReconciler;
  currentStateSync: CurrentStateSync;
}

export function createAccountSyncRuntime(input: {
  db: Db;
  factory: RuntimeContextFactory;
  factoryRef: { factory: RuntimeContextFactory | null };
  lotsRepo: LotsRepo;
  logger: EventLogger;
  strategyEngine: StrategyExecutionEngine;
  backfillStrategiesForAccount: (accountId: number) => void;
  broadcastTradeExecution: (event: TradeExecutionEvent) => void;
}): AccountSyncRuntime {
  const currentStateSyncRef: { sync: CurrentStateSync | null } = { sync: null };
  const balanceSync = new BalanceSync({
    getBroker: () => input.factory.getBroker(),
    getAccountId: () => input.factory.getActiveAccountId(),
    lotsRepo: input.lotsRepo,
    logger: input.logger,
  });
  balanceSync.start();
  input.factory.setBalanceSync(balanceSync);

  const manualOrderReconciler = new ManualOrderReconciler({
    db: input.db,
    getBrokerForAccount: (accountId) => {
      const ctx = input.factoryRef.factory;
      if (!ctx) return null;
      const env = ctx.getCurrentEnv();
      const active = ctx.getActiveAccountId();
      if (env === null || active !== accountId) return null;
      return ctx.getBroker();
    },
    logger: input.logger,
    onTradeExecution: (event) => {
      input.logger.log({
        level: 'INFO',
        category: 'ORDER',
        message: 'manual-order-reconciler.trade-executed',
        payload: {
          accountId: event.accountId,
          odno: event.odno,
          pdno: event.pdno,
          side: event.side,
          status: event.status,
          filledQty: event.filledQty,
          totalFilledQty: event.totalFilledQty,
          remainingQty: event.remainingQty,
          price: event.price,
        },
      });
      input.broadcastTradeExecution(event);
      currentStateSyncRef.sync?.trigger('trade-event');
      // Q-E: KIS REST 잔고 API lag (1~3초) 흡수용 backoff 재시도. 30초 polling 보다 빠르게
      // 화면 잔고를 갱신해 사용자 stale 인지 (체결 후 0건 표시) 차단.
      balanceSync.refreshWithBackoff();
    },
  });
  manualOrderReconciler.start();

  const currentStateSync = new CurrentStateSync({
    balanceSync,
    logger: input.logger,
    manualOrderReconciler,
    onRefreshed: () => {
      const accountId = input.factory.getActiveAccountId();
      if (accountId !== null) {
        input.backfillStrategiesForAccount(accountId);
      }
      input.strategyEngine.refreshTrackedSymbols();
    },
  });
  currentStateSyncRef.sync = currentStateSync;
  input.factory.setCurrentStateSync(currentStateSync);
  currentStateSync.trigger('startup');

  return { balanceSync, manualOrderReconciler, currentStateSync };
}

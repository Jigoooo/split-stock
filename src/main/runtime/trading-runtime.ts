import type { AppEnv } from '@shared/contracts';
import { isRegularMarketOpenKst } from '@shared/trading/market-session';
import WebSocket from 'ws';
import type { ActiveAccountRepo } from '../account/active-account';
import type { Db } from '../db/client';
import { readRealtimeConfig, type SettingsRepo } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import { realTimer, type WsLike } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import { FeedBus } from '../realtime/feed-bus';
import { RealtimeService } from '../realtime/realtime-service';
import type { ProtectionGuard } from '../safety/protection-guard';
import type { RateGuardRepo } from '../safety/rate-guard';
import type { SafetyStateRegistry } from '../safety/safety-state';
import type { TimeWindowRepo } from '../safety/time-window';
import type { CredentialsRepo } from '../security/credentials-repo';
import { AutoBuyGuard } from '../trading/auto-buy-guard';
import { isAutoOrderBlockedError } from '../trading/auto-order-errors';
import { BoosterService } from '../trading/booster-service';
import { createEnvAwarePricePoller } from '../trading/env-aware-price-poller';
import { createInFlightCoordinator } from '../trading/in-flight-coordinator';
import type { LotsRepo } from '../trading/lots-repo';
import { MarketSessionGuard } from '../trading/market-session-guard';
import type { PendingOrderWatcher } from '../trading/pending-order-watcher';
import type { PrebuyRepo } from '../trading/prebuy-repo';
import type { PrebuyWatcher } from '../trading/prebuy-watcher';
import { StrategyExecutionEngine } from '../trading/strategy-execution-engine';
import type { StrategyRepo } from '../trading/strategy-repo';
import { RotatingQuoteFeed } from '../trading/tiered-quote-feed';
import { WatchEngine, type WatchOrder } from '../trading/watch-engine';
import { quarantineLegacyWatchRows } from '../trading/watch-legacy-quarantine';
import { executeStrategyOrder, executeWatchOrder } from '../trading/watch-order-executor';
import type { createContextFactory } from '../trpc/context';
import { createPendingCancelWatcher } from './pending-cancel-runtime';
import { createPrebuyWatchers, resolvePrebuySource } from './prebuy-runtime';
import { SharedPriceFeedRegistry } from './shared-price-feed';
import type { WatchEventDispatchers } from './watch-events';

type RuntimeContextFactory = ReturnType<typeof createContextFactory>;

export interface TradingRuntime {
  bus: FeedBus;
  watchEngine: WatchEngine;
  strategyEngine: StrategyExecutionEngine;
  pendingOrderWatcher: PendingOrderWatcher;
  prebuyWatchers: Map<number, PrebuyWatcher>;
  quoteFeed: RotatingQuoteFeed;
  realtimeFactory: (env: AppEnv | null) => RealtimeService | null;
  boosterService: BoosterService;
}

export function createTradingRuntime(input: {
  db: Db;
  settingsRepo: SettingsRepo;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  safetyRegistry: SafetyStateRegistry;
  logger: EventLogger;
  lotsRepo: LotsRepo;
  strategyRepo: StrategyRepo;
  prebuyRepo: PrebuyRepo;
  activeAccounts: ActiveAccountRepo;
  timeWindowRepo: TimeWindowRepo;
  rateGuardRepo: RateGuardRepo;
  protectionGuard: ProtectionGuard;
  factoryRef: { factory: RuntimeContextFactory | null };
  watchEvents: WatchEventDispatchers;
  broadcastToAllWindows: (channel: string, ...args: unknown[]) => void;
}): TradingRuntime {
  quarantineLegacyWatchRows(input.db, input.logger);

  const sharedFeed = new SharedPriceFeedRegistry();
  const watchTrackedPdnosRef = new Set<string>();
  const strategyTrackedPdnosRef = new Set<string>();
  const syncWatchPriceFeed = (pdnos: string[]): void => {
    sharedFeed.syncTracked(watchTrackedPdnosRef, pdnos);
  };
  const syncStrategyPriceFeed = (pdnos: string[]): void => {
    sharedFeed.syncTracked(strategyTrackedPdnosRef, pdnos);
  };
  const inFlightCoordinator = createInFlightCoordinator();
  const watchEngine = new WatchEngine({
    db: input.db,
    timer: realTimer,
    inFlightCoordinator,
    onWatchingPdnosChanged: syncWatchPriceFeed,
    onExecuted: (order) => {
      input.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'watch.executed',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
        },
      });
      input.watchEvents.broadcastWatchOutcome(
        input.watchEvents.toWatchOutcomeEvent('EXECUTED', order),
      );
    },
    onFailed: (order, reason) => {
      input.logger.log({
        level: 'WARN',
        category: 'WATCH',
        message: 'watch.failed',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
          reason,
        },
      });
      input.watchEvents.broadcastWatchOutcome(
        input.watchEvents.toWatchOutcomeEvent('FAILED', order, { failureReason: reason }),
      );
    },
    onExpired: (order) => {
      input.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'watch.expired',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
        },
      });
      input.watchEvents.broadcastWatchOutcome(
        input.watchEvents.toWatchOutcomeEvent('EXPIRED', order),
      );
    },
  });
  watchEngine.startCycle();

  const bus = new FeedBus();
  const quoteFeed = new RotatingQuoteFeed({
    timer: realTimer,
    poller: createEnvAwarePricePoller({
      getBroker: () => input.factoryRef.factory?.getBroker() ?? null,
    }),
    logger: input.logger,
    getRatePerSec: () => {
      const env = input.factoryRef.factory?.getCurrentEnv() ?? null;
      if (env === 'MOCK') return isRegularMarketOpenKst() ? 4 : 2;
      return isRegularMarketOpenKst() ? 18 : 6;
    },
  });
  quoteFeed.on('quote', ({ pdno, price }) => {
    bus.emitTick({
      pdno,
      time: '',
      price,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 0,
      accumVolume: 0,
      open: 0,
      high: 0,
      low: 0,
      bestAsk: 0,
      bestBid: 0,
    });
    watchEngine.onPrice(pdno, price);
  });
  quoteFeed.on('cooldown', ({ pdno, failures, error }) => {
    const reason = error.kind ?? 'unknown';
    input.logger.log({
      level: 'WARN',
      category: 'WATCH',
      message: 'quote-feed.cooldown',
      payload: { pdno, failures, reason },
    });
    input.broadcastToAllWindows('appShell:quote-feed-cooldown', { pdno, failures, reason });
  });
  sharedFeed.setFeed(quoteFeed);

  const pendingOrderWatcher = createPendingCancelWatcher({
    timer: realTimer,
    db: input.db,
    settingsRepo: input.settingsRepo,
    credentialsRepo: input.credentialsRepo,
    auth: input.auth,
    httpByEnv: input.httpByEnv,
    logger: input.logger,
    factoryRef: input.factoryRef,
  });
  const marketSessionGuard = new MarketSessionGuard({
    getBroker: () => input.factoryRef.factory?.getBroker() ?? null,
    logger: input.logger,
  });
  const autoBuyGuard = new AutoBuyGuard({
    logger: input.logger,
    protectionGuard: input.protectionGuard,
    rateGuardRepo: input.rateGuardRepo,
    strategyRepo: input.strategyRepo,
    timeWindowRepo: input.timeWindowRepo,
  });
  const runWatchedOrder = async (order: WatchOrder, triggerPrice: number): Promise<void> => {
    await executeWatchOrder(
      {
        db: input.db,
        settingsRepo: input.settingsRepo,
        getBrokerForAccount: (accountId) => {
          const ctx = input.factoryRef.factory;
          if (!ctx || ctx.getActiveAccountId() !== accountId) return null;
          return ctx.getBroker();
        },
        safetyRegistry: input.safetyRegistry,
        pendingOrderWatcher,
        logger: input.logger,
        lotsRepo: input.lotsRepo,
        strategyRepo: input.strategyRepo,
        marketSessionGuard,
        autoBuyGuard,
      },
      order,
      triggerPrice,
    );
  };
  const isKeepWatchingError = (error: unknown): boolean =>
    isAutoOrderBlockedError(error) ||
    (error instanceof Error &&
      /이미 활성 차수가 있어 신규 1차 자동진입을 생략/.test(error.message));

  watchEngine.setFallbackHandler('CUSTOM', async (order, ctx) =>
    runWatchFallback(order, ctx.price, runWatchedOrder, isKeepWatchingError),
  );
  watchEngine.setFallbackHandler('PREBUY', async (order, ctx) => {
    const source = resolvePrebuySource(input.prebuyRepo, order);
    if (!source.ok) return source.result;
    try {
      await runWatchedOrder(order, ctx.price);
      input.prebuyRepo.markFilled(source.prebuyId);
      return { ok: true };
    } catch (error) {
      return toWatchFailure(error, isKeepWatchingError);
    }
  });

  const strategyEngine = new StrategyExecutionEngine({
    bus,
    logger: input.logger,
    lotsRepo: input.lotsRepo,
    strategyRepo: input.strategyRepo,
    safetyRegistry: input.safetyRegistry,
    inFlightCoordinator,
    getActiveAccountId: () => input.factoryRef.factory?.getActiveAccountId() ?? null,
    onTrackedPdnosChanged: syncStrategyPriceFeed,
    onAutoOrderRetryScheduled: input.watchEvents.broadcastAutoOrderRetry,
    marketSessionGuard,
    executeOrder: async (orderInput) =>
      executeStrategyOrder(
        {
          db: input.db,
          settingsRepo: input.settingsRepo,
          getBrokerForAccount: (accountId) => {
            const ctx = input.factoryRef.factory;
            if (!ctx || ctx.getActiveAccountId() !== accountId) return null;
            return ctx.getBroker();
          },
          safetyRegistry: input.safetyRegistry,
          pendingOrderWatcher,
          logger: input.logger,
          lotsRepo: input.lotsRepo,
          strategyRepo: input.strategyRepo,
          autoBuyGuard,
        },
        orderInput,
      ),
  });
  syncWatchPriceFeed(watchEngine.list({ status: 'WATCHING' }).map((order) => order.pdno));
  strategyEngine.refreshTrackedSymbols();

  const prebuyWatchers = createPrebuyWatchers(input, watchEngine, runWatchedOrder);
  let lastRealtime: RealtimeService | null = null;
  const realtimeFactory = (env: AppEnv | null): RealtimeService | null => {
    if (lastRealtime) {
      lastRealtime.stop();
      lastRealtime = null;
    }
    if (env) {
      const realtimeCfg = readRealtimeConfig(input.settingsRepo);
      lastRealtime = new RealtimeService({
        env,
        http: input.httpByEnv[env],
        bus,
        factory: (url: string): WsLike => new WebSocket(url) as unknown as WsLike,
        logger: input.logger,
        maxSubscriptions: realtimeCfg.wsCapacity,
        getAccountId: () => input.factoryRef.factory?.getActiveAccountId() ?? null,
        restFallback: {
          subscribe: (pdno: string) => sharedFeed.acquire(pdno),
          unsubscribe: (pdno: string) => sharedFeed.release(pdno),
        },
      });
    }
    return lastRealtime;
  };

  const boosterService = new BoosterService({
    timer: realTimer,
    bus,
    getRealtime: () => lastRealtime,
    db: input.db,
    settingsRepo: input.settingsRepo,
    getBrokerForAccount: (accountId) => {
      const ctx = input.factoryRef.factory;
      if (!ctx || ctx.getActiveAccountId() !== accountId) return null;
      return ctx.getBroker();
    },
    safetyRegistry: input.safetyRegistry,
    pendingOrderWatcher,
    logger: input.logger,
    lotsRepo: input.lotsRepo,
    strategyRepo: input.strategyRepo,
    marketSessionGuard,
    autoBuyGuard,
  });

  return {
    bus,
    watchEngine,
    strategyEngine,
    pendingOrderWatcher,
    prebuyWatchers,
    quoteFeed,
    realtimeFactory,
    boosterService,
  };
}

async function runWatchFallback(
  order: WatchOrder,
  price: number,
  runWatchedOrder: (order: WatchOrder, triggerPrice: number) => Promise<void>,
  isKeepWatchingError: (error: unknown) => boolean,
) {
  try {
    await runWatchedOrder(order, price);
    return { ok: true };
  } catch (error) {
    return toWatchFailure(error, isKeepWatchingError);
  }
}

function toWatchFailure(error: unknown, isKeepWatchingError: (error: unknown) => boolean) {
  return {
    ok: false,
    reason: error instanceof Error ? error.message : String(error),
    ...(isKeepWatchingError(error) ? { keepWatching: true } : {}),
  };
}

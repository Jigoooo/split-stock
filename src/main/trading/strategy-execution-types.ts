import type { AutoOrderRetryEvent } from '@shared/contracts';
import type { Timer } from '../brokers/core/types';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { SafetyStateRegistry } from '../safety/safety-state';
import type { InFlightCoordinator } from './in-flight-coordinator';
import type { LotsRepo } from './lots-repo';
import type { AutoOrderMarketGuard } from './market-session-guard';
import type { StrategyRepo } from './strategy-repo';

export interface StrategyExecutionOrderResult {
  brokerOrderId: string;
  reconciled: boolean;
}

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
    reconcileOnly?: boolean;
    side: 'BUY' | 'SELL';
    triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  }) => Promise<StrategyExecutionOrderResult | undefined>;
  marketSessionGuard?: AutoOrderMarketGuard;
  onTrackedPdnosChanged?: (pdnos: string[]) => void;
  onAutoOrderRetryScheduled?: (event: AutoOrderRetryEvent) => void;
  autoOrderRetryCooldownMs?: number;
  timer?: Timer;
  /** WatchEngine 등 다른 source 와 cross-dedupe 위한 공유 coordinator (선택). */
  inFlightCoordinator?: InFlightCoordinator;
}

export interface StrategyOrderIdentity {
  kind: 'BUY' | 'SELL';
  nth: number;
  pdno: string;
}

export interface StrategyOrderEventInput {
  accountId: number;
  nth: number;
  pdno: string;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
}

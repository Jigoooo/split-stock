import type { BrokerError, BrokerErrorKind, BrokerId } from '@shared/contracts';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { Db } from '../db/client';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import type { SafetyStateRegistry } from '../safety/safety-state';
import type { AutoBuyGuardPort } from './auto-buy-guard';
import type { LotsRepo } from './lots-repo';
import type { AutoOrderMarketGuard } from './market-session-guard';
import type { PendingOrderWatcher } from './pending-order-watcher';
import type { StrategyRepo } from './strategy-repo';
import type { WatchOrder } from './watch-engine';

export interface WatchOrderExecutorDeps {
  db: Db;
  settingsRepo: SettingsRepo;
  /**
   * 활성 계좌의 BrokerPort 를 lazy 로 얻는 getter. broker null 이면 자격증명/
   * 환경 미준비 → 주문 실패.
   */
  getBrokerForAccount: (accountId: number) => BrokerPort | null;
  safetyRegistry: SafetyStateRegistry;
  pendingOrderWatcher: PendingOrderWatcher | null;
  logger: EventLogger;
  lotsRepo: LotsRepo;
  strategyRepo: StrategyRepo;
  marketSessionGuard?: AutoOrderMarketGuard;
  autoBuyGuard?: AutoBuyGuardPort;
}

export interface StrategyOrderInput {
  accountId: number;
  pdno: string;
  side: 'BUY' | 'SELL';
  division: 'LIMIT' | 'MARKET';
  nth: number;
  price: number;
  qty: number;
  triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  reconcileOnly?: boolean;
}

export interface StrategyOrderExecutionResult {
  brokerOrderId: string;
  reconciled: boolean;
}

export interface PreparedOrderLot {
  lotId: number;
  nth: number | null;
  side: 'BUY' | 'SELL';
}

export type AutoOrderLocalSource = WatchOrder['source'] | 'STRATEGY';

export class StrategyOrderError extends Error {
  readonly brokerError: BrokerError;
  readonly brokerId: BrokerId;
  readonly kind: BrokerErrorKind;
  readonly raw: BrokerError['raw'] | undefined;
  readonly side: 'BUY' | 'SELL';
  readonly pdno: string;
  readonly qty: number;
  readonly price: number;
  readonly nth: number;
  readonly attemptedAt: Date;

  constructor(input: StrategyOrderInput, brokerError: BrokerError, attemptedAt: Date) {
    super(`주문 실패: ${brokerError.kind} - ${brokerError.msg}`);
    this.name = 'StrategyOrderError';
    this.brokerError = brokerError;
    this.brokerId = brokerError.brokerId;
    this.kind = brokerError.kind;
    this.raw = brokerError.raw;
    this.side = input.side;
    this.pdno = input.pdno;
    this.qty = input.qty;
    this.price = input.division === 'LIMIT' ? input.price : 0;
    this.nth = input.nth;
    this.attemptedAt = attemptedAt;
  }
}

export function isStrategyOrderError(error: unknown): error is StrategyOrderError {
  return error instanceof StrategyOrderError;
}

import type { AutoOrderRetryEvent, BrokerErrorKind } from '@shared/contracts';
import type { Timer } from '../brokers/core/types';
import type { EventLogger } from '../logging/event-logger';
import type { SafetyStateRegistry } from '../safety/safety-state';
import { type AutoOrderBlockCode, isPassiveMarketClosedBlockCode } from './auto-order-errors';
import type { StrategyOrderEventInput, StrategyOrderIdentity } from './strategy-execution-types';
import { isStrategyOrderError } from './watch-order-executor';

interface StrategyRetryRuntimeOptions {
  autoOrderRetryCooldownMs: number | undefined;
  evaluateLatest: (pdno: string) => boolean;
  getActiveAccountId: () => number | null;
  logger: EventLogger;
  onAutoOrderRetryScheduled: ((event: AutoOrderRetryEvent) => void) | undefined;
  safetyRegistry: SafetyStateRegistry;
  timer: Timer;
}

export class StrategyRetryRuntime {
  private readonly blockedLogLastAt = new Map<string, number>();
  private readonly retryCooldownUntil = new Map<string, number>();
  private readonly retryTimers = new Map<string, { clear: () => void }>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryReconcileOnly = new Set<string>();
  private readonly retryErrorKinds = new Map<string, BrokerErrorKind>();
  private readonly attentionRequiredKeys = new Set<string>();

  constructor(private readonly opts: StrategyRetryRuntimeOptions) {}

  dispose(): void {
    for (const retryTimer of this.retryTimers.values()) retryTimer.clear();
    this.retryTimers.clear();
    this.retryCooldownUntil.clear();
    this.retryAttempts.clear();
    this.retryReconcileOnly.clear();
    this.retryErrorKinds.clear();
    this.attentionRequiredKeys.clear();
  }

  handleOrderFailure(input: StrategyOrderEventInput & { error: unknown }): void {
    const decision = this.classifyOrderFailure(input.error);
    if (decision.status === 'RETRYING') {
      this.scheduleOrderRetry({
        ...input,
        ...(decision.errorKind !== undefined && { errorKind: decision.errorKind }),
        reason: decision.reason,
      });
      return;
    }
    this.emitOrderStatus({
      ...input,
      attempt: this.peekNextAttempt(input.accountId, input.pdno, input.side, input.nth),
      ...(decision.errorKind !== undefined && { errorKind: decision.errorKind }),
      failureType: 'FAILED',
      reason: decision.reason,
      retryAfterMs: null,
      status: decision.status,
    });
  }

  handleOrderBlocked(
    input: StrategyOrderEventInput & { code: AutoOrderBlockCode; reason: string },
  ): void {
    const logKey = `${input.accountId}:${input.pdno}:${input.code}:${input.side}`;
    const now = this.opts.timer.now();
    const lastAt = this.blockedLogLastAt.get(logKey);
    if (lastAt !== undefined && now - lastAt < 60_000) return;
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
        qty: input.qty,
        reason: input.reason,
        side: input.side,
        triggerReason: input.triggerReason,
      },
    });
    if (isPassiveMarketClosedBlockCode(input.code)) return;
    this.emitOrderStatus({
      accountId: input.accountId,
      attempt: 1,
      failureType: 'BLOCKED',
      nth: input.nth,
      pdno: input.pdno,
      price: input.price,
      qty: input.qty,
      reason: input.reason,
      retryAfterMs: null,
      side: input.side,
      status: 'WAITING_CONDITION',
      triggerReason: input.triggerReason,
    });
  }

  handleTickFailure(pdno: string, price: number, error: unknown): void {
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

  isOrderRetryCoolingDown(accountId: number, order: StrategyOrderIdentity): boolean {
    const retryKey = this.retryKey(accountId, order.pdno, order.kind, order.nth);
    if (this.attentionRequiredKeys.has(retryKey)) return true;
    const until = this.retryCooldownUntil.get(retryKey);
    if (until === undefined) return false;
    if (this.opts.timer.now() < until) return true;
    this.retryCooldownUntil.delete(retryKey);
    return false;
  }

  clearOrderRetry(accountId: number, order: StrategyOrderIdentity): void {
    const retryKey = this.retryKey(accountId, order.pdno, order.kind, order.nth);
    this.retryCooldownUntil.delete(retryKey);
    this.retryTimers.get(retryKey)?.clear();
    this.retryTimers.delete(retryKey);
    this.retryAttempts.delete(retryKey);
    this.retryReconcileOnly.delete(retryKey);
    this.retryErrorKinds.delete(retryKey);
    this.attentionRequiredKeys.delete(retryKey);
  }

  isRetryReconcileOnly(accountId: number, order: StrategyOrderIdentity): boolean {
    const retryKey = this.retryKey(accountId, order.pdno, order.kind, order.nth);
    return this.retryReconcileOnly.has(retryKey);
  }

  retryErrorKind(accountId: number, order: StrategyOrderIdentity): BrokerErrorKind | undefined {
    const retryKey = this.retryKey(accountId, order.pdno, order.kind, order.nth);
    return this.retryErrorKinds.get(retryKey);
  }

  peekNextAttempt(accountId: number, pdno: string, side: 'BUY' | 'SELL', nth: number): number {
    const retryKey = this.retryKey(accountId, pdno, side, nth);
    return (this.retryAttempts.get(retryKey) ?? 0) + 1;
  }

  private classifyOrderFailure(error: unknown): {
    errorKind?: BrokerErrorKind;
    reason: string;
    status: AutoOrderRetryEvent['status'];
  } {
    if (!isStrategyOrderError(error)) {
      return {
        reason: describeUnknownError(error),
        status: 'NEEDS_ATTENTION',
      };
    }

    if (error.kind === 'NETWORK' || error.kind === 'RATE_LIMITED' || error.kind === 'UNKNOWN') {
      return { errorKind: error.kind, reason: error.message, status: 'RETRYING' };
    }

    if (error.kind === 'BUSINESS' && shouldWaitForCondition(error.message)) {
      return { errorKind: error.kind, reason: error.message, status: 'WAITING_CONDITION' };
    }

    return { errorKind: error.kind, reason: error.message, status: 'NEEDS_ATTENTION' };
  }

  private scheduleOrderRetry(
    input: StrategyOrderEventInput & { errorKind?: BrokerErrorKind; reason: string },
  ): void {
    const retryKey = this.retryKey(input.accountId, input.pdno, input.side, input.nth);
    const attempt = (this.retryAttempts.get(retryKey) ?? 0) + 1;
    const retryAfterMs = attempt <= 3 ? (this.opts.autoOrderRetryCooldownMs ?? 3_000) : 10_000;
    if (attempt > 6) {
      this.retryAttempts.set(retryKey, attempt);
      this.emitOrderStatus({
        ...input,
        attempt,
        failureType: 'FAILED',
        retryAfterMs: null,
        status: 'NEEDS_ATTENTION',
      });
      return;
    }
    this.retryAttempts.set(retryKey, attempt);
    if (input.errorKind === 'NETWORK' || input.errorKind === 'UNKNOWN') {
      this.retryReconcileOnly.add(retryKey);
    }
    if (input.errorKind !== undefined) {
      this.retryErrorKinds.set(retryKey, input.errorKind);
    }
    const retryAfterAt = this.opts.timer.now() + retryAfterMs;
    this.retryCooldownUntil.set(retryKey, retryAfterAt);
    this.retryTimers.get(retryKey)?.clear();
    this.retryTimers.set(
      retryKey,
      this.opts.timer.setTimeout(() => {
        this.retryTimers.delete(retryKey);
        this.retryCooldownUntil.delete(retryKey);
        this.opts.evaluateLatest(input.pdno);
      }, retryAfterMs),
    );

    this.opts.logger.log({
      level: 'WARN',
      category: 'FSM',
      message: 'strategy-engine.order-retry-scheduled',
      payload: {
        accountId: input.accountId,
        nth: input.nth,
        pdno: input.pdno,
        price: input.price,
        reason: input.reason,
        retryAfterMs,
        side: input.side,
        triggerReason: input.triggerReason,
        attempt,
        errorKind: input.errorKind,
      },
    });
    this.emitOrderStatus({
      ...input,
      attempt,
      failureType: 'FAILED',
      retryAfterMs,
      status: 'RETRYING',
    });
  }

  private emitOrderStatus(input: {
    accountId: number;
    attempt: number;
    errorKind?: BrokerErrorKind;
    failureType: 'BLOCKED' | 'FAILED';
    nth: number;
    pdno: string;
    price: number;
    qty: number;
    reason: string;
    retryAfterMs: number | null;
    side: 'BUY' | 'SELL';
    status: AutoOrderRetryEvent['status'];
    triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
  }): void {
    if (input.status === 'NEEDS_ATTENTION') {
      this.attentionRequiredKeys.add(
        this.retryKey(input.accountId, input.pdno, input.side, input.nth),
      );
    }
    this.opts.onAutoOrderRetryScheduled?.({
      accountId: input.accountId,
      attempt: input.attempt,
      ...(input.errorKind !== undefined && { errorKind: input.errorKind }),
      failureType: input.failureType,
      nth: input.nth,
      occurredAt: this.opts.timer.now(),
      pdno: input.pdno,
      price: input.price,
      qty: input.qty,
      reason: input.reason,
      retryAfterMs: input.retryAfterMs,
      side: input.side,
      status: input.status,
      triggerReason: input.triggerReason,
    });
  }

  private retryKey(accountId: number, pdno: string, side: 'BUY' | 'SELL', nth: number): string {
    return `${accountId}:${pdno}:${side}:${nth}`;
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function shouldWaitForCondition(reason: string): boolean {
  return /장|시간|영업일|주말|휴장|주문가능|market|session/i.test(reason);
}

import type { AutoOrderRetryEvent, TradeExecutionEvent } from '@shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { WatchOrder } from '../trading/watch-engine';
import { createWatchEventDispatchers, createWatchOutcomeEvent } from './watch-events';

const watchOrder: WatchOrder = {
  id: 7,
  accountId: 3,
  pdno: '005930',
  source: 'CUSTOM',
  side: 'BUY',
  targetPrice: 70000,
  comparator: 'LTE',
  orderType: 'LIMIT',
  qtyOrAmountMode: 'QTY',
  qty: 1,
  amountKrw: null,
  nth: 1,
  sourceRefId: null,
  expiresAt: null,
  status: 'WATCHING',
  lastFailureReason: null,
  metadata: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  executedAt: null,
};

describe('watch event helpers', () => {
  it('watch order를 stable outcome event로 매핑한다', () => {
    expect(
      createWatchOutcomeEvent({
        status: 'FAILED',
        order: watchOrder,
        now: () => 12345,
        extras: { triggerPrice: 69900, failureReason: 'BLOCKED' },
      }),
    ).toEqual({
      watchId: 7,
      accountId: 3,
      pdno: '005930',
      source: 'CUSTOM',
      side: 'BUY',
      status: 'FAILED',
      targetPrice: 70000,
      triggerPrice: 69900,
      orderType: 'LIMIT',
      failureReason: 'BLOCKED',
      occurredAt: 12345,
    });
  });

  it('watch outcome과 trade execution을 기존 IPC 채널로 브로드캐스트하고 OS 알림 payload를 유지한다', () => {
    const broadcastToAllWindows = vi.fn();
    const notifyWatchOutcome = vi.fn();
    const notifyTrade = vi.fn();
    const dispatchers = createWatchEventDispatchers({
      settingsRepo: { get: () => 'true' },
      logger: { log: vi.fn() },
      broadcastToAllWindows,
      notifyWatchOutcome,
      notifyTrade,
      now: () => 12345,
    });
    const outcome = dispatchers.toWatchOutcomeEvent('EXECUTED', watchOrder);
    const trade: TradeExecutionEvent = {
      accountId: 3,
      odno: 'ODNO',
      pdno: '005930',
      name: '삼성전자',
      side: 'SELL',
      status: 'FILLED',
      filledQty: 2,
      totalFilledQty: 2,
      remainingQty: 0,
      price: 71000,
      occurredAt: 12346,
    };

    dispatchers.broadcastWatchOutcome(outcome);
    dispatchers.broadcastTradeExecution(trade);

    expect(notifyWatchOutcome).toHaveBeenCalledWith(outcome, null);
    expect(notifyTrade).toHaveBeenCalledWith({
      pdno: '005930',
      side: 'sell',
      qty: 2,
      price: 71000,
      name: '삼성전자',
    });
    expect(broadcastToAllWindows).toHaveBeenCalledWith('appShell:watch-event', outcome);
    expect(broadcastToAllWindows).toHaveBeenCalledWith('appShell:trade-event', trade);
  });

  it('invalid auto-order retry event는 로그만 남기고 브로드캐스트하지 않는다', () => {
    const logger = { log: vi.fn() };
    const broadcastToAllWindows = vi.fn();
    const dispatchers = createWatchEventDispatchers({
      settingsRepo: { get: () => 'false' },
      logger,
      broadcastToAllWindows,
      notifyWatchOutcome: vi.fn(),
      notifyTrade: vi.fn(),
    });
    const invalidRetry = {
      accountId: 3,
      pdno: '005930',
      side: 'BUY',
      nth: 1,
      triggerReason: 'PROFIT_SELL',
      failureType: 'FAILED',
      status: 'RETRYING',
      attempt: 1,
      price: 70000,
      qty: 1,
      reason: 'retry',
      retryAfterMs: null,
      occurredAt: 12345,
    } as unknown as AutoOrderRetryEvent;

    dispatchers.broadcastAutoOrderRetry(invalidRetry);

    expect(broadcastToAllWindows).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'ERROR',
        category: 'FSM',
        message: 'auto-order-retry.invalid-event',
      }),
    );
  });
});

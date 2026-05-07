import type {
  AutoOrderRetryEvent,
  TradeExecutionEvent,
  WatchOutcomeEvent,
} from '@shared/contracts';
import { AutoOrderRetryEventSchema } from '@shared/contracts';
import type { EventLogger } from '../logging/event-logger';
import type { WatchOrder } from '../trading/watch-engine';

interface NotificationSettings {
  get(key: string): string | undefined | null;
}

export interface WatchEventDispatchers {
  toWatchOutcomeEvent: (
    status: WatchOutcomeEvent['status'],
    order: WatchOrder,
    extras?: {
      triggerPrice?: number | null;
      failureReason?: string | null;
    },
  ) => WatchOutcomeEvent;
  broadcastWatchOutcome: (event: WatchOutcomeEvent) => void;
  broadcastAutoOrderRetry: (event: AutoOrderRetryEvent) => void;
  broadcastTradeExecution: (event: TradeExecutionEvent) => void;
}

export function createWatchOutcomeEvent(input: {
  status: WatchOutcomeEvent['status'];
  order: WatchOrder;
  now: () => number;
  extras?: {
    triggerPrice?: number | null;
    failureReason?: string | null;
  };
}): WatchOutcomeEvent {
  const { status, order, now, extras = {} } = input;
  return {
    watchId: order.id,
    accountId: order.accountId,
    pdno: order.pdno,
    source: order.source,
    side: order.side,
    status,
    targetPrice: order.targetPrice,
    triggerPrice: extras.triggerPrice ?? null,
    orderType: order.orderType,
    failureReason: extras.failureReason ?? null,
    occurredAt: now(),
  };
}

export function createWatchEventDispatchers(input: {
  settingsRepo: NotificationSettings;
  logger: EventLogger;
  broadcastToAllWindows: (channel: string, ...args: unknown[]) => void;
  notifyWatchOutcome: (event: WatchOutcomeEvent, name?: string | null) => void;
  notifyTrade: (event: {
    pdno: string;
    side: 'buy' | 'sell';
    qty: number;
    price: number;
    name: string;
  }) => void;
  /** pdno → 종목명 lookup (stockMasterRepo). 없으면 pdno 만 알림에 표시. */
  resolveStockName?: (pdno: string) => string | null;
  now?: () => number;
}): WatchEventDispatchers {
  const now = input.now ?? Date.now;
  const osNotificationsEnabled = (): boolean =>
    input.settingsRepo.get('notifications.osEnabled') !== 'false';

  return {
    toWatchOutcomeEvent: (status, order, extras = {}) =>
      createWatchOutcomeEvent({ status, order, extras, now }),
    broadcastWatchOutcome: (event) => {
      if (osNotificationsEnabled()) {
        const name = input.resolveStockName?.(event.pdno) ?? null;
        input.notifyWatchOutcome(event, name);
      }
      input.broadcastToAllWindows('appShell:watch-event', event);
    },
    broadcastAutoOrderRetry: (event) => {
      const parsed = AutoOrderRetryEventSchema.safeParse(event);
      if (!parsed.success) {
        input.logger.log({
          level: 'ERROR',
          category: 'FSM',
          message: 'auto-order-retry.invalid-event',
          payload: { reason: parsed.error.message },
        });
        return;
      }
      input.broadcastToAllWindows('appShell:auto-order-retry', parsed.data);
    },
    broadcastTradeExecution: (event) => {
      if (osNotificationsEnabled()) {
        input.notifyTrade({
          pdno: event.pdno,
          side: event.side === 'BUY' ? 'buy' : 'sell',
          qty: event.filledQty,
          price: event.price,
          name: event.name,
        });
      }
      input.broadcastToAllWindows('appShell:trade-event', event);
    },
  };
}

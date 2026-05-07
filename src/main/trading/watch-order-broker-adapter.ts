import type { CryptoAutoEvent } from '@shared/contracts';
import { BROKERS } from '@shared/contracts';
import type { WatchHistoryItem } from '../trpc/handlers/watch-handler-shared';

/**
 * Phase 3 → P4-4: cryptoWatchToWatchOrder / cryptoWatchesToWatchOrders 폐기.
 * P4-1/2/3 후 코인 자동감시 데이터는 watchOrders(broker='UPBIT') 에 직접 저장되므로
 * watch-list-handlers 가 직접 SELECT 한다 — adapter 매핑 불필요.
 *
 * 본 모듈은 event_logs → WatchHistoryItem 변환 (cryptoEventToWatchHistoryItem) 만 유지.
 * event_logs 는 broker 다양성과 무관하게 코인 자동매매 history 의 정착지.
 */

/**
 * Phase 4-bis: 코인 자동매매 event → WatchHistoryItem 변환.
 *
 * CryptoAutoEvent 의 kind/action/reason 을 history 메시지로 매핑하고, blocked/decimal-error
 * 는 WARN/ERROR 로 강등한다. 다른 kind 는 INFO.
 */
export function cryptoEventToWatchHistoryItem(event: CryptoAutoEvent): WatchHistoryItem {
  const level: WatchHistoryItem['level'] =
    event.kind === 'decimal-error' ? 'ERROR' : event.kind === 'blocked' ? 'WARN' : 'INFO';
  const message = `auto-crypto.${event.kind}.${event.action}`;
  return {
    id: event.id,
    at: new Date(event.createdAt),
    level,
    message,
    accountId: event.accountId,
    pdno: event.market,
    // 코인 events 는 stock source('PREBUY'/'CUSTOM') 개념이 없음 — 'CUSTOM' 으로 통일.
    source: 'CUSTOM',
    watchId: null,
    reason: event.reason || null,
  };
}

export function cryptoEventsToWatchHistoryItems(events: CryptoAutoEvent[]): WatchHistoryItem[] {
  return events.map(cryptoEventToWatchHistoryItem);
}

export const CRYPTO_DISPATCH_BROKER = BROKERS.UPBIT;

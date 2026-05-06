import type { CryptoAutoEvent, CryptoAutoWatch, CryptoAutoWatchStatus } from '@shared/contracts';
import { BROKERS } from '@shared/contracts';
import type { WatchHistoryItem } from '../trpc/handlers/watch-handler-shared';
import type { WatchOrder, WatchSource, WatchStatus } from './watch-engine-types';

/**
 * Phase 3: broker 별 자동감시 데이터 모델 dispatch.
 *
 * stock(KIS/KIWOOM) 과 코인(UPBIT) 은 자동감시 자료구조가 분리되어 있다:
 *   - stock: watchOrders 테이블 (단일 가격 트리거 → 1회 주문)
 *   - 코인: cryptoAutoWatches 테이블 (차수 전략 + 보호 설정 + 자동매수/매도 사이클)
 *
 * 두 모델은 의미가 다르지만 WatchBoard UI 가 broker 별로 동일한 4탭 (현황/실행내역/실패/히스토리)
 * 를 보여주므로, CryptoAutoWatch 를 stock WatchOrder shape 에 best-effort 매핑한 view 로 흡수해
 * UI 코드 변경 없이 데이터를 흘려보낸다.
 *
 * 의미상 대응:
 *   - id, accountId, status, createdAt, updatedAt: 직접 매핑 (CryptoAutoWatchStatus 는 WatchStatus
 *     의 부분집합 — EXPIRED 만 없음)
 *   - pdno = market (e.g. 'KRW-BTC')
 *   - source = 'CUSTOM' (코인 watch 는 source 개념 없음 — UI 에서 PREBUY/CUSTOM 만 표시)
 *   - side = 'BUY' (코인 자동감시는 매수 진입 + 차수 전략 자동 운영, 일반적으로 매수 컨텍스트)
 *   - targetPrice = entryCondition.price (immediate 모드면 0)
 *   - comparator = 'LTE' (지정가 이하 매수 — best guess)
 *   - orderType = strategy.autoBuyOrderType ('MARKET' / 'LIMIT')
 *   - qtyOrAmountMode = 'AMOUNT', amountKrw = config.maxOrderKrw
 *   - nth = currentStage
 *   - executedAt = lastActionAt
 *   - lastFailureReason = blockedReasons[0]
 *   - metadata = label
 *   - sourceRefId = null, expiresAt = null, qty = null
 */

const num = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** CryptoAutoWatchStatus 는 WatchStatus 의 부분집합이므로 그대로 캐스팅 가능 (EXPIRED 미생성). */
function mapStatus(status: CryptoAutoWatchStatus): WatchStatus {
  return status as WatchStatus;
}

export function cryptoWatchToWatchOrder(watch: CryptoAutoWatch): WatchOrder {
  const entryPrice = watch.entryCondition.price;
  const targetPrice = entryPrice ? Math.round(num(entryPrice)) : 0;
  const orderType = watch.strategy.autoBuyOrderType;
  const amountKrw = Math.round(num(watch.config.maxOrderKrw));
  const lastFailureReason = watch.blockedReasons[0] ?? null;

  return {
    id: watch.id,
    accountId: watch.accountId,
    pdno: watch.market,
    source: 'CUSTOM' satisfies WatchSource,
    side: 'BUY',
    targetPrice,
    comparator: 'LTE',
    orderType,
    qtyOrAmountMode: 'AMOUNT',
    qty: null,
    amountKrw: amountKrw > 0 ? amountKrw : null,
    nth: watch.currentStage > 0 ? watch.currentStage : null,
    sourceRefId: null,
    expiresAt: null,
    status: mapStatus(watch.status),
    lastFailureReason,
    metadata: watch.label,
    createdAt: new Date(watch.createdAt),
    updatedAt: new Date(watch.updatedAt),
    executedAt: watch.lastActionAt ? new Date(watch.lastActionAt) : null,
  };
}

/** UPBIT broker 자동감시 → WatchOrder list. CryptoAutoTradingRepo.listWatches 결과를 변환. */
export function cryptoWatchesToWatchOrders(watches: CryptoAutoWatch[]): WatchOrder[] {
  return watches.map(cryptoWatchToWatchOrder);
}

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

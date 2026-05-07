import { BROKERS, isCryptoBroker } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { CryptoAutoTradingRepo } from '../../crypto/crypto-auto-repo';
import { eventLogs, watchOrders } from '../../db/schema';
import type { WatchOrder, WatchSource, WatchStatus } from '../../trading/watch-engine-types';
import { cryptoEventsToWatchHistoryItems } from '../../trading/watch-order-broker-adapter';
import type { Context } from '../context';
import {
  ensureActiveAccountId,
  ensureWatchEngine,
  type WatchHistoryInput,
  type WatchHistoryItem,
  type WatchListInput,
} from './watch-handler-shared';

/** watchOrders DB 행 → WatchOrder shape 매핑. drizzle 의 timestamp_ms 모드는 Date 로 변환됨. */
function mapWatchOrderRow(row: typeof watchOrders.$inferSelect): WatchOrder {
  return {
    id: row.id,
    accountId: row.accountId,
    pdno: row.pdno,
    source: row.source as WatchSource,
    side: row.side as 'BUY' | 'SELL',
    targetPrice: row.targetPrice,
    comparator: row.comparator as 'LTE' | 'GTE',
    orderType: row.orderType as 'MARKET' | 'LIMIT',
    qtyOrAmountMode: row.qtyOrAmountMode as 'QTY' | 'AMOUNT',
    qty: row.qty,
    amountKrw: row.amountKrw,
    nth: row.nth,
    sourceRefId: row.sourceRefId,
    expiresAt: row.expiresAt,
    status: row.status as WatchStatus,
    lastFailureReason: row.lastFailureReason,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    executedAt: row.executedAt,
  };
}

/**
 * Phase 3 → P4-4: broker dispatch. UPBIT 는 watchOrders(broker='UPBIT') 직접 조회
 * (P4-3 이후 cryptoAutoWatches 폐기, watchOrders 가 source-of-truth). KIS/KIWOOM 은
 * 기존 watchEngine 사용. 코인 자동감시는 BOOSTER source 가 없어 별도 필터 불필요.
 */
export function listWatchOrders(ctx: Context, input: WatchListInput) {
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== undefined && input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌의 자동감시주문은 조회할 수 없습니다.',
    });
  }
  if (isCryptoBroker(input.broker)) {
    const filters = [
      eq(watchOrders.broker, BROKERS.UPBIT),
      eq(watchOrders.accountId, activeAccountId),
    ];
    if (input.status !== undefined) filters.push(eq(watchOrders.status, input.status));
    if (input.source !== undefined) filters.push(eq(watchOrders.source, input.source));
    const orders = ctx.db
      .select()
      .from(watchOrders)
      .where(and(...filters))
      .orderBy(desc(watchOrders.updatedAt))
      .all()
      .map(mapWatchOrderRow);
    return { orders };
  }
  const watchEngine = ensureWatchEngine(ctx);
  return {
    orders: watchEngine
      .list({
        status: input.status,
        source: input.source,
        accountId: activeAccountId,
      })
      .filter((order) => order.source !== 'BOOSTER'),
  };
}

export function listWatchHistory(ctx: Context, input: WatchHistoryInput | undefined) {
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (isCryptoBroker(input?.broker)) {
    // Phase 4-bis: 코인 자동매매 event_logs(category='AUTO_CRYPTO', message='auto-crypto.*')
    // 를 WatchHistoryItem shape 으로 변환해 WatchBoard history 탭에 노출.
    const limit = input?.limit ?? 200;
    const events = new CryptoAutoTradingRepo(ctx.db).listRecentEventsAcrossMarkets(
      activeAccountId,
      limit,
    );
    return { items: cryptoEventsToWatchHistoryItems(events) };
  }
  const rows = ctx.db
    .select()
    .from(eventLogs)
    .where(eq(eventLogs.category, 'WATCH'))
    .orderBy(desc(eventLogs.id))
    .limit(input?.limit ?? 200)
    .all();
  const items = rows
    .map((row): WatchHistoryItem | null => {
      let payload: Record<string, unknown> = {};
      try {
        payload = row.payloadJson ? (JSON.parse(row.payloadJson) as Record<string, unknown>) : {};
      } catch {
        payload = {};
      }
      const accountId =
        typeof payload.accountId === 'number' && Number.isInteger(payload.accountId)
          ? payload.accountId
          : null;
      if (accountId !== activeAccountId) return null;
      return {
        id: row.id,
        at: row.ts,
        level: row.level as 'INFO' | 'WARN' | 'ERROR',
        message: row.message,
        accountId,
        pdno: typeof payload.pdno === 'string' ? payload.pdno : null,
        source: payload.source === 'PREBUY' || payload.source === 'CUSTOM' ? payload.source : null,
        watchId:
          typeof payload.watchId === 'number' && Number.isInteger(payload.watchId)
            ? payload.watchId
            : null,
        reason: typeof payload.reason === 'string' ? payload.reason : null,
      };
    })
    .filter((item): item is WatchHistoryItem => item !== null);
  return { items };
}

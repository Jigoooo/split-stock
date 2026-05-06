import { isCryptoBroker } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { CryptoAutoTradingRepo } from '../../crypto/crypto-auto-repo';
import { eventLogs } from '../../db/schema';
import { cryptoWatchesToWatchOrders } from '../../trading/watch-order-broker-adapter';
import type { Context } from '../context';
import {
  ensureActiveAccountId,
  ensureWatchEngine,
  type WatchHistoryInput,
  type WatchHistoryItem,
  type WatchListInput,
} from './watch-handler-shared';

/**
 * Phase 3: broker dispatch — input.broker 가 코인 broker (UPBIT) 면 cryptoAutoWatches 데이터를
 * WatchOrder shape 으로 변환해 반환. 그렇지 않으면 기본 stock watchEngine 사용.
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
    const watches = new CryptoAutoTradingRepo(ctx.db).listWatches(activeAccountId);
    let orders = cryptoWatchesToWatchOrders(watches);
    if (input.status !== undefined) {
      const status = input.status;
      orders = orders.filter((order) => order.status === status);
    }
    if (input.source !== undefined) {
      const source = input.source;
      orders = orders.filter((order) => order.source === source);
    }
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
    // Phase 3: 코인 자동감시 history 는 event_logs `auto-crypto.*` prefix 로 별도 기록.
    // 현재 단계는 dispatch 골격만 — UI 가 빈 결과를 정상 처리하므로 빈 list 반환.
    // 코인 사이클 history 는 별도 entity (crypto.listClosedLots 등) 로 노출 중이라
    // WatchBoard 의 history 탭은 Phase 4 에서 상세 매핑.
    return { items: [] satisfies WatchHistoryItem[] };
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

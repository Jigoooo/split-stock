import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { eventLogs } from '../../db/schema';
import type { Context } from '../context';
import {
  ensureActiveAccountId,
  ensureWatchEngine,
  type WatchHistoryInput,
  type WatchHistoryItem,
  type WatchListInput,
} from './watch-handler-shared';

export function listWatchOrders(ctx: Context, input: WatchListInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== undefined && input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌의 자동감시주문은 조회할 수 없습니다.',
    });
  }
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

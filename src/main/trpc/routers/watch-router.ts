import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { eventLogs, watchOrders } from '../../db/schema';
import { readWatchGlobalEnabled, watchGlobalEnabledKey } from '../../db/settings-repo';
import type { EventLogger } from '../../logging/event-logger';
import { WatchOrderInputSchema } from '../../trading/watch-engine';
import { authedProcedure, router } from '../trpc-core';

const ListInputSchema = z.object({
  status: z.enum(['WATCHING', 'PAUSED', 'EXECUTED', 'FAILED', 'EXPIRED', 'CANCELLED']).optional(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).optional(),
  accountId: z.number().int().positive().optional(),
});

const HistoryItemSchema = z.object({
  id: z.number().int().positive(),
  at: z.date(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  message: z.string(),
  accountId: z.number().int().positive(),
  pdno: z.string().nullable(),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']).nullable(),
  watchId: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
});

/**
 * 활성 계좌 강제 — null 이면 PRECONDITION_FAILED.
 * 다른 helper(`router-helpers.ts`)와 동일한 에러 코드/메시지 패턴.
 */
function ensureActiveAccountId(activeAccountId: number | null): number {
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다. 자격증명을 먼저 등록하세요.',
    });
  }
  return activeAccountId;
}

function logWatchEvent(
  ctx: { logger?: EventLogger },
  event: {
    level: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    accountId: number;
    watchId: number;
    pdno: string;
    source: string;
    reason?: string | null;
  },
): void {
  ctx.logger?.log({
    level: event.level,
    category: 'WATCH',
    message: event.message,
    payload: {
      accountId: event.accountId,
      watchId: event.watchId,
      pdno: event.pdno,
      source: event.source,
      reason: event.reason ?? null,
    },
  });
}

/**
 * 통합 자동감시주문 라우터.
 * - list: 현황/실행내역/실패 탭에서 status별 필터링
 * - history: WATCH 카테고리 이벤트 로그 기반 lifecycle timeline
 * - control: 전역 ON/OFF, pause/resume/cancel/update
 * - create: CUSTOM source용 신규 등록 — 활성 계좌 한정
 */
export const watchRouter = router({
  list: authedProcedure.input(ListInputSchema).query(({ ctx, input }) => {
    if (!ctx.watchEngine) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'watchEngine이 초기화되지 않음',
      });
    }
    const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
    if (input.accountId !== undefined && input.accountId !== activeAccountId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '다른 계좌의 자동감시주문은 조회할 수 없습니다.',
      });
    }
    return {
      orders: ctx.watchEngine.list({
        status: input.status,
        source: input.source,
        accountId: activeAccountId,
      }),
    };
  }),

  getControlState: authedProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const accountId = input?.accountId ?? activeAccountId;
      if (accountId !== activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌의 자동감시 상태는 조회할 수 없습니다.',
        });
      }
      const orders = ctx.watchEngine.list({ accountId });
      const watchingCount = orders.filter((order) => order.status === 'WATCHING').length;
      const pausedCount = orders.filter((order) => order.status === 'PAUSED').length;
      return {
        globalEnabled: readWatchGlobalEnabled(ctx.settingsRepo, accountId),
        watchingCount,
        pausedCount,
        totalTrackedCount: watchingCount + pausedCount,
      };
    }),

  setGlobalEnabled: authedProcedure
    .input(z.object({ enabled: z.boolean(), accountId: z.number().int().positive().optional() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const accountId = input.accountId ?? activeAccountId;
      if (accountId !== activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌의 자동감시 상태는 변경할 수 없습니다.',
        });
      }
      ctx.settingsRepo.set(watchGlobalEnabledKey(accountId), input.enabled ? 'true' : 'false');
      ctx.watchEngine.setGlobalEnabled(accountId, input.enabled);
      ctx.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: `watch.global.${input.enabled ? 'on' : 'off'}`,
        payload: { accountId },
      });
      return { globalEnabled: input.enabled };
    }),

  pause: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const owned = ctx.db
        .select()
        .from(watchOrders)
        .where(and(eq(watchOrders.id, input.id), eq(watchOrders.accountId, activeAccountId)))
        .get();
      if (!owned) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 자동감시주문을 찾을 수 없습니다.',
        });
      }
      const r = ctx.watchEngine.pause(input.id);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `일시중지 실패: ${r.error.kind}`,
        });
      }
      logWatchEvent(ctx, {
        level: 'INFO',
        message: 'watch.paused',
        accountId: owned.accountId,
        watchId: owned.id,
        pdno: owned.pdno,
        source: owned.source,
      });
      return { ok: true as const };
    }),

  resume: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const owned = ctx.db
        .select()
        .from(watchOrders)
        .where(and(eq(watchOrders.id, input.id), eq(watchOrders.accountId, activeAccountId)))
        .get();
      if (!owned) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 자동감시주문을 찾을 수 없습니다.',
        });
      }
      const r = ctx.watchEngine.resume(input.id);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `재개 실패: ${r.error.kind}`,
        });
      }
      logWatchEvent(ctx, {
        level: 'INFO',
        message: 'watch.resumed',
        accountId: r.value.accountId,
        watchId: r.value.id,
        pdno: r.value.pdno,
        source: r.value.source,
      });
      return { order: r.value };
    }),

  cancel: authedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const owned = ctx.db
        .select()
        .from(watchOrders)
        .where(and(eq(watchOrders.id, input.id), eq(watchOrders.accountId, activeAccountId)))
        .get();
      if (!owned) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 자동감시주문을 찾을 수 없습니다.',
        });
      }
      if (owned.source === 'PREBUY' && owned.sourceRefId) {
        const prebuyId = Number(owned.sourceRefId);
        if (Number.isInteger(prebuyId) && prebuyId > 0) {
          ctx.prebuyRepo.cancel(prebuyId);
        }
      }
      const r = ctx.watchEngine.cancel(input.id);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `취소 실패: ${r.error.kind}`,
        });
      }
      logWatchEvent(ctx, {
        level: 'INFO',
        message: 'watch.cancelled',
        accountId: owned.accountId,
        watchId: owned.id,
        pdno: owned.pdno,
        source: owned.source,
      });
      return { ok: true as const };
    }),

  create: authedProcedure.input(WatchOrderInputSchema).mutation(({ ctx, input }) => {
    if (!ctx.watchEngine) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'watchEngine이 초기화되지 않음',
      });
    }
    const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
    if (input.accountId !== activeAccountId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '다른 계좌로의 자동감시주문 등록은 허용되지 않습니다.',
      });
    }
    const r = ctx.watchEngine.register(input);
    if (r.isErr()) {
      throw new TRPCError({
        code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: `등록 실패: ${r.error.kind}`,
      });
    }
    logWatchEvent(ctx, {
      level: 'INFO',
      message: 'watch.created',
      accountId: r.value.accountId,
      watchId: r.value.id,
      pdno: r.value.pdno,
      source: r.value.source,
    });
    return { order: r.value };
  }),

  update: authedProcedure
    .input(WatchOrderInputSchema.and(z.object({ id: z.number().int().positive() })))
    .mutation(({ ctx, input }) => {
      if (!ctx.watchEngine) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'watchEngine이 초기화되지 않음',
        });
      }
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const owned = ctx.db
        .select()
        .from(watchOrders)
        .where(and(eq(watchOrders.id, input.id), eq(watchOrders.accountId, activeAccountId)))
        .get();
      if (!owned) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 자동감시주문을 찾을 수 없습니다.',
        });
      }
      if (owned.source !== 'CUSTOM') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'CUSTOM 자동감시만 수정할 수 있습니다.',
        });
      }
      if (input.accountId !== activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌로의 자동감시주문 수정은 허용되지 않습니다.',
        });
      }
      const r = ctx.watchEngine.update(input.id, input);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `수정 실패: ${r.error.kind}`,
        });
      }
      logWatchEvent(ctx, {
        level: 'INFO',
        message: 'watch.updated',
        accountId: r.value.accountId,
        watchId: r.value.id,
        pdno: r.value.pdno,
        source: r.value.source,
      });
      return { order: r.value };
    }),

  history: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional())
    .output(z.object({ items: z.array(HistoryItemSchema) }))
    .query(({ ctx, input }) => {
      const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
      const rows = ctx.db
        .select()
        .from(eventLogs)
        .where(eq(eventLogs.category, 'WATCH'))
        .orderBy(desc(eventLogs.id))
        .limit(input?.limit ?? 200)
        .all();
      const items = rows
        .map((row) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = row.payloadJson
              ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
              : {};
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
            source:
              payload.source === 'BOOSTER' ||
              payload.source === 'PREBUY' ||
              payload.source === 'CUSTOM'
                ? payload.source
                : null,
            watchId:
              typeof payload.watchId === 'number' && Number.isInteger(payload.watchId)
                ? payload.watchId
                : null,
            reason: typeof payload.reason === 'string' ? payload.reason : null,
          };
        })
        .filter((item): item is z.infer<typeof HistoryItemSchema> => item !== null);
      return { items };
    }),
});

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { readPendingCancelConfig, SETTING_KEYS } from '../../db/settings-repo';
import { resolveAccountId } from '../router-helpers';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

const ReorderModeSchema = z.enum(['NONE', 'MARKET', 'LIMIT_AT_LAST_PRICE']);

const PendingCancelSettingsSchema = z.object({
  enabled: z.boolean(),
  timeoutMinutes: z.number().int().min(1).max(60),
  maxCancels: z.union([z.number().int().min(1).max(30), z.literal(-1)]),
  reorderMode: ReorderModeSchema,
});

/**
 * 미체결 자동취소(F6) 설정 + 활성 감시 목록 라우터.
 *
 * - getSettings: 현재 설정 조회 (public — 환경 선택 전에도 설정 확인 가능)
 * - updateSettings: 설정 변경 (authed — 환경 선택 후)
 * - listActive: 현재 감시 중인 미체결 목록 (authed, activeAccountId 기준)
 * - unregister: 감시 해제 (authed, accountId 명시 필수)
 *
 * 보안 가드:
 * - listActive/unregister 모두 ctx.activeAccountId 기준으로 격리.
 * - 다른 계좌의 항목 조회/해제 거부.
 */
export const pendingCancelRouter = router({
  /**
   * 현재 미체결 자동취소 설정 조회.
   * maxCancels: -1 = 무제한, 1~30 = 유한.
   */
  getSettings: publicProcedure.query(({ ctx }) => {
    const cfg = readPendingCancelConfig(ctx.settingsRepo);
    const maxCancels: number = cfg.maxRetries === null ? -1 : cfg.maxRetries;
    return {
      enabled: cfg.enabled,
      timeoutMinutes: Math.round(cfg.timeoutMs / 60_000),
      maxCancels,
      reorderMode: cfg.reorderMode,
    };
  }),

  /**
   * 미체결 자동취소 설정 변경.
   */
  updateSettings: authedProcedure.input(PendingCancelSettingsSchema).mutation(({ ctx, input }) => {
    const repo = ctx.settingsRepo;
    repo.set(SETTING_KEYS.PENDING_CANCEL_ENABLED, String(input.enabled));
    repo.set(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN, String(input.timeoutMinutes));
    repo.set(
      SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES,
      input.maxCancels === -1 ? 'unlimited' : String(input.maxCancels),
    );
    repo.set(SETTING_KEYS.PENDING_CANCEL_REORDER_MODE, input.reorderMode);
    return { ok: true as const };
  }),

  /**
   * 현재 감시 중인 미체결 주문 목록 — activeAccountId 기준.
   */
  listActive: authedProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => {
      if (!ctx.pendingOrderWatcher) {
        return { items: [] };
      }
      const activeAccountId = resolveAccountId(ctx, input ?? {});
      const all = ctx.pendingOrderWatcher.listActive();
      // per-account 격리: accountId가 있는 항목은 활성 계좌와 일치할 때만 반환
      const filtered = all.filter(
        (e) => e.accountId === undefined || e.accountId === activeAccountId,
      );
      return { items: filtered };
    }),

  /**
   * 특정 감시 항목 해제 — accountId 명시 필수, 본인 계좌 항목만 해제 가능.
   */
  unregister: authedProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/),
        side: z.enum(['BUY', 'SELL']),
        nth: z.number().int().positive(),
        accountId: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ctx.pendingOrderWatcher) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'pendingOrderWatcher가 초기화되지 않음',
        });
      }
      // 소유권 검증 — 다른 계좌의 항목 해제 차단
      if (ctx.activeAccountId !== null && input.accountId !== ctx.activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌의 미체결 감시 항목은 해제할 수 없습니다.',
        });
      }
      const all = ctx.pendingOrderWatcher.listActive();
      const found = all.find(
        (e) =>
          e.pdno === input.pdno &&
          e.side === input.side &&
          e.nth === input.nth &&
          (e.accountId === undefined || e.accountId === input.accountId),
      );
      if (!found) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '해당 미체결 감시 항목을 찾을 수 없습니다.',
        });
      }
      ctx.pendingOrderWatcher.cancel({ pdno: input.pdno, side: input.side, nth: input.nth });
      return { ok: true as const };
    }),
});

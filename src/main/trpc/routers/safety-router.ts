import { z } from 'zod';
import { resolveAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive().optional();

/**
 * 안전 스위치 라우터 — per-account 격리.
 * accountId 미지정 시 활성 계좌 fallback (BC 호환). 거래성 mutation 도 read-modify-write
 * 패턴이라 fallback 허용 — 단, 호출측이 다중 계좌 UI 면 명시적으로 accountId 전달 권장.
 */
export const safetyRouter = router({
  getState: publicProcedure
    .input(z.object({ accountId: AccountIdField }).optional())
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      return ctx.safetyRegistry.get(accountId).getSnapshot();
    }),

  setMaster: publicProcedure
    .input(z.object({ on: z.boolean(), accountId: AccountIdField }))
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      return ctx.safetyRegistry.get(accountId).setMaster(input.on);
    }),

  toggleSymbol: publicProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/),
        on: z.boolean(),
        accountId: AccountIdField,
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      return ctx.safetyRegistry.get(accountId).toggleSymbol(input.pdno, input.on);
    }),

  /**
   * 킬 스위치 — 기본은 활성 계좌만. all=true 면 모든 등록된 계좌의 master OFF.
   */
  triggerKillSwitch: publicProcedure
    .input(
      z.object({
        reason: z.string().default('사용자 단축키'),
        accountId: AccountIdField,
        all: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (input.all) {
        ctx.safetyRegistry.triggerKillSwitchAll(input.reason);
        return { ok: true as const, scope: 'all' as const };
      }
      const accountId = resolveAccountId(ctx, input);
      const snap = ctx.safetyRegistry.get(accountId).triggerKillSwitch(input.reason);
      return { ok: true as const, scope: 'account' as const, snapshot: snap };
    }),

  clearErrorLock: publicProcedure
    .input(z.object({ accountId: AccountIdField }).optional())
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      return ctx.safetyRegistry.get(accountId).clearErrorLock();
    }),
});

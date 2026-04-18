import { buildLotOverlay, type LotOverlaySnapshot } from '@shared/trading/lot-overlay';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { inquireBalance } from '../../kis/domestic-stock';
import { authedProcedure, router } from '../trpc-core';

/**
 * 계좌/잔고 조회 라우터.
 * - getBalance: inquire-balance 호출 후 Position[] + 예수금 반환
 * - getPositionOverlay: 차트 위에 표시할 차수 오버레이 라인 반환
 */
export const accountRouter = router({
  getBalance: authedProcedure.query(async ({ ctx }) => {
    const env = ctx.currentEnv;
    if (!env) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
    }
    const credResult = ctx.credentialsRepo.loadCredentials(env);
    if (credResult.isErr() || !credResult.value) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: '자격증명 없음 — 로그인 필요',
      });
    }
    const cred = credResult.value;
    const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
    if (tokenResult.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `토큰 발급 실패: ${tokenResult.error.kind}`,
      });
    }
    const http = ctx.httpByEnv[env];
    const r = await inquireBalance({
      http,
      env,
      token: tokenResult.value.token,
      appKey: cred.appKey,
      appSecret: cred.appSecret,
      accountNo8: cred.accountNo8,
      accountProdCd: cred.accountProdCd,
    });
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `잔고조회 실패: ${r.error.kind} - ${r.error.msg}`,
      });
    }
    return r.value;
  }),

  getPositionOverlay: authedProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/),
        accountId: z.number().int().positive().default(1),
        includeSold: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) => {
      const snap = ctx.lotsRepo.snapshot(input.accountId, input.pdno);
      if (snap.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `차수 조회 실패: ${snap.error.kind}`,
        });
      }
      const active = ctx.strategyRepo.getActive(input.pdno);
      const globalActive = ctx.strategyRepo.getActive(null);
      const profile =
        (active.isOk() ? active.value : null) ?? (globalActive.isOk() ? globalActive.value : null);
      const profitPct = profile?.profitPct ?? 0.05;
      const overlay: LotOverlaySnapshot[] = snap.value.lots.map((l) => ({
        nth: l.nth,
        buyPrice: l.buyPrice,
        qty: l.qty,
        status: l.status,
      }));
      const lines = buildLotOverlay(overlay, { profitPct, includeSold: input.includeSold });
      return { lines, profitPct };
    }),
});

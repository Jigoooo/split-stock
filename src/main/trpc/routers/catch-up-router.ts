import { z } from 'zod';
import { scanCatchUp } from '../../trading/catch-up-detector';
import { authedProcedure, router } from '../trpc-core';

/**
 * NM-016 catch-up 통합 다이얼로그 router.
 *
 * 부팅 시 renderer 가 scan() 호출 → 도달한 차수가 있는 종목들 반환.
 * 사용자 결정은 applyDecision() mutation 으로 round-trip.
 *
 * MVP scope: 결정 결과를 event_logs 에 기록만. 실제 진입은 별도 phase.
 * 사용자가 "모두 진입" 선택해도 그 자체로는 주문 발사 안 됨 — 대신 자동매매 정상
 * 가동되어 다음 tick 에서 fsm 평가 진행 (현재가가 trigger 이하면 자동 진입).
 */
export const CatchUpDecisionSchema = z.enum(['ENTER_ALL', 'ENTER_DEEPEST_ONLY', 'IGNORE']);
export type CatchUpDecision = z.infer<typeof CatchUpDecisionSchema>;

export const catchUpRouter = router({
  /**
   * 활성 계좌의 모든 종목에 대해 catch-up scan.
   * maxReachedNth ≥ 2 인 종목만 반환 (다음 차수 trigger 도달).
   */
  scan: authedProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      if (ctx.activeAccountId !== input.accountId) {
        return { items: [] as const };
      }
      const items = scanCatchUp(
        {
          lotsRepo: ctx.lotsRepo,
          strategyRepo: ctx.strategyRepo,
          getCurrentPrice: (pdno) => ctx.bus?.getLatestTick(pdno)?.price ?? null,
          resolveStockName: (pdno) => ctx.stockMasterRepo.find(pdno)?.name ?? null,
        },
        input.accountId,
      );
      return { items };
    }),

  /**
   * 종목별 사용자 결정 적용. event_logs INFO 기록만 (MVP).
   * 실제 주문 진입 로직은 별도 phase 에서 추가.
   */
  applyDecision: authedProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: z.string().regex(/^\d{6}$/),
        decision: CatchUpDecisionSchema,
        maxReachedNth: z.number().int().positive().nullable(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'catch-up.decision-applied',
        payload: {
          accountId: input.accountId,
          pdno: input.pdno,
          decision: input.decision,
          maxReachedNth: input.maxReachedNth,
        },
      });
      return { ok: true as const };
    }),
});

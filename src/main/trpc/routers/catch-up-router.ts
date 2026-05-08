import { z } from 'zod';
import {
  type CatchUpPendingItem,
  clearCatchUpPending,
  readCatchUpPending,
  writeCatchUpPending,
} from '../../db/settings-catch-up';
import { broadcastToAllWindows } from '../../ipc/app-shell-ipc';
import { type CatchUpItem, scanCatchUp } from '../../trading/catch-up-detector';
import { authedProcedure, router } from '../trpc-core';

/**
 * NM-016 catch-up 통합 다이얼로그 router.
 *
 * 부팅 시 renderer 가 scan() 호출 → 도달한 차수가 있는 종목들 반환.
 * 사용자 결정은 applyDecision() / dismiss() / timeoutDismiss() mutation 으로 round-trip.
 *
 * Phase B 강화 (this commit):
 *  - scan items.length>0 → strategyEngine.pause('catch-up-pending'): 사용자 결정 전까지 fsm 차단.
 *  - scan items.length>0 → broadcastToAllWindows('appShell:catch-up-detected'): renderer 즉시 모달.
 *  - dismiss(): pending batch 영속화 + resume(). 다음 부팅 재노출.
 *  - timeoutDismiss(): pending 유지 (영속화 변경 없음) + resume(). 안전 default.
 *  - applyDecision() 마지막 호출 시 (모든 종목 결정 완료) resume() + clearPending().
 */
export const CatchUpDecisionSchema = z.enum(['ENTER_ALL', 'ENTER_DEEPEST_ONLY', 'IGNORE']);
export type CatchUpDecision = z.infer<typeof CatchUpDecisionSchema>;

const PendingItemEchoSchema = z.object({
  accountId: z.number().int().positive(),
  pdno: z.string().regex(/^\d{6}$/),
  name: z.string(),
  maxReachedNth: z.number().int().positive().nullable(),
});

/**
 * pending batch 와 fresh scan 결과를 머지. 동일 (accountId, pdno) 는 fresh 우선.
 * fresh 에서 빠진 pending 항목은 살아있는 의사 표시 ("나중에 결정") 이므로
 * informational placeholder 로 유지 (현재가 / triggers 없이 표시 가능하도록 minimal 필드만).
 */
function mergeWithPending(
  fresh: readonly CatchUpItem[],
  pending: readonly CatchUpPendingItem[],
): CatchUpItem[] {
  const seen = new Set<string>();
  const result: CatchUpItem[] = [];
  for (const item of fresh) {
    const key = `${item.accountId}:${item.pdno}`;
    seen.add(key);
    result.push(item);
  }
  for (const p of pending) {
    const key = `${p.accountId}:${p.pdno}`;
    if (seen.has(key)) continue;
    // pending 만 살아있는 항목 — 가격/triggers 없이 placeholder 형태로 표시.
    result.push({
      accountId: p.accountId,
      pdno: p.pdno,
      name: p.name,
      currentPrice: 0,
      lots: [],
      triggers: [],
      maxReachedNth: p.maxReachedNth,
    });
  }
  return result;
}

export const catchUpRouter = router({
  /**
   * 활성 계좌의 모든 종목에 대해 catch-up scan + pending merge.
   * items.length>0 이면 strategyEngine.pause + IPC push.
   */
  scan: authedProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      if (ctx.activeAccountId !== input.accountId) {
        return { items: [] as const };
      }
      const fresh = scanCatchUp(
        {
          lotsRepo: ctx.lotsRepo,
          strategyRepo: ctx.strategyRepo,
          getCurrentPrice: (pdno) => ctx.bus?.getLatestTick(pdno)?.price ?? null,
          resolveStockName: (pdno) => ctx.stockMasterRepo.find(pdno)?.name ?? null,
        },
        input.accountId,
      );
      const pendingBatch = readCatchUpPending(ctx.settingsRepo);
      const pending = (pendingBatch?.items ?? []).filter((p) => p.accountId === input.accountId);
      const merged = mergeWithPending(fresh, pending);
      if (merged.length > 0) {
        // strategyEngine pause — 사용자 결정 전까지 자동매매 차단. idempotent.
        ctx.strategyEngine?.pause('catch-up-pending');
        broadcastToAllWindows('appShell:catch-up-detected', {
          accountId: input.accountId,
          items: merged,
        });
      }
      return { items: merged };
    }),

  /**
   * 종목별 사용자 결정 적용. event_logs INFO 기록만 (MVP).
   * 실제 주문 진입 로직은 별도 phase 에서 추가.
   *
   * `isLastDecision=true` 로 호출되면 strategyEngine.resume + pending 영속화 정리.
   * renderer 는 batch 마지막 항목 적용 시 isLastDecision=true 로 보낸다.
   */
  applyDecision: authedProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: z.string().regex(/^\d{6}$/),
        decision: CatchUpDecisionSchema,
        maxReachedNth: z.number().int().positive().nullable(),
        isLastDecision: z.boolean().optional(),
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
      if (input.isLastDecision) {
        clearCatchUpPending(ctx.settingsRepo);
        ctx.strategyEngine?.resume('catch-up-pending');
      }
      return { ok: true as const };
    }),

  /**
   * "나중에 결정" — pending batch 영속화 + strategyEngine.resume.
   * 다음 부팅 시 scan + pending merge 로 다시 노출.
   */
  dismiss: authedProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        items: z.array(PendingItemEchoSchema),
      }),
    )
    .mutation(({ ctx, input }) => {
      writeCatchUpPending(ctx.settingsRepo, input.items);
      ctx.strategyEngine?.resume('catch-up-pending');
      ctx.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'catch-up.dismissed',
        payload: { accountId: input.accountId, itemCount: input.items.length },
      });
      return { ok: true as const };
    }),

  /**
   * 30초 timeout fallback — 사용자 응답 없음.
   * pending batch 변경 없음 (다음 부팅 재감지 시 자연스럽게 재노출) + resume.
   * "안전 default = 무시" 정책: 사용자 의사 모를 때 자동매매는 정상 가동, 단 다음 부팅에서 재확인.
   */
  timeoutDismiss: authedProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      ctx.strategyEngine?.resume('catch-up-pending');
      ctx.logger.log({
        level: 'WARN',
        category: 'FSM',
        message: 'catch-up.timeout-dismissed',
        payload: { accountId: input.accountId },
      });
      return { ok: true as const };
    }),
});

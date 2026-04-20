import { CredentialsSchema } from '@shared/contracts';
import { buildLotOverlay, type LotOverlaySnapshot } from '@shared/trading/lot-overlay';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { lots as lotsTable } from '../../db/schema';
import { SETTING_KEYS } from '../../db/settings-repo';
import { inquireBalance } from '../../kis/domestic-stock';
import { resolveAccountId } from '../router-helpers';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

/**
 * 계좌/잔고 조회 라우터.
 * - listAccounts: 등록된 모든 계좌 목록 (UI 탭 전환용)
 * - getActive: 현재 활성 계좌 메타
 * - setActive: 활성 계좌 전환 (단일성 트랜잭션 + env/realtime 동기 전환)
 * - add: 신규 계좌 등록 (= 자격증명 저장 + accounts upsert)
 * - rename: displayName 변경
 * - delete: 계좌 삭제 (활성/lots 잔여 가드)
 * - getBalance: inquire-balance 호출 후 Position[] + 예수금 반환
 * - getPositionOverlay: 차트 위에 표시할 차수 오버레이 라인 반환
 */
export const accountRouter = router({
  listAccounts: publicProcedure.query(({ ctx }) => ({
    accounts: ctx.activeAccounts.list(),
    activeAccountId: ctx.activeAccountId,
  })),

  getActive: publicProcedure.query(({ ctx }) => ({
    accountId: ctx.activeAccountId,
    account: ctx.activeAccountId !== null ? ctx.activeAccounts.getById(ctx.activeAccountId) : null,
  })),

  setActive: publicProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      // 1) 대상 계좌 존재 확인 + env 추출.
      const target = ctx.activeAccounts.getById(input.accountId);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '대상 계좌를 찾을 수 없습니다' });
      }
      // 2) accounts.is_active 단일성 보장 트랜잭션.
      const r = ctx.activeAccounts.setActiveAccountId(input.accountId);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `활성 계좌 변경 실패: ${r.error.kind}`,
        });
      }
      // 3) 컨텍스트의 activeAccountId 갱신.
      ctx.setActiveAccountId(input.accountId);
      // 4) env 가 다르면 currentEnv 도 원자적으로 동기 — realtime 재생성 트리거.
      const prevEnv = ctx.currentEnv;
      if (prevEnv !== target.env) {
        ctx.setCurrentEnv(target.env);
        ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, target.env);
      }
      ctx.logger.log({
        level: target.env === 'PROD' ? 'WARN' : 'INFO',
        category: 'AUTH',
        message: 'account.active.changed',
        payload: { accountId: input.accountId, env: target.env, prevEnv },
      });
      return {
        ok: true as const,
        accountId: input.accountId,
        env: target.env,
      };
    }),

  /**
   * 신규 계좌 추가 — 자격증명 저장 + accounts upsert 를 한 번에.
   * `auth.setCredentials` 와 동등한 흐름. 활성 계좌는 변경하지 않는다 (UX 일관성).
   */
  add: publicProcedure.input(CredentialsSchema).mutation(({ ctx, input }) => {
    const accountResult = ctx.activeAccounts.upsertFromCredentials({
      env: input.env,
      accountNo8: input.accountNo8,
      accountProdCd: input.accountProdCd,
    });
    if (accountResult.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `계좌 등록 실패: ${accountResult.error.kind}`,
      });
    }
    const accountId = accountResult.value;
    const r = ctx.credentialsRepo.saveCredentials(accountId, input);
    if (r.isErr()) {
      throw new TRPCError({
        code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: `자격증명 저장 실패: ${r.error.kind}`,
      });
    }
    // 첫 계좌면 upsertFromCredentials 가 자동 활성화 — 컨텍스트에 반영.
    const activeNow = ctx.activeAccounts.getActiveAccountId();
    if (activeNow !== null && ctx.activeAccountId !== activeNow) {
      ctx.setActiveAccountId(activeNow);
      // 첫 계좌 자동 활성화 시 env 도 동기 — realtimeFactory 재생성 + 영속.
      if (ctx.currentEnv !== input.env) {
        ctx.setCurrentEnv(input.env);
        ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, input.env);
      }
    }
    ctx.logger.log({
      level: 'INFO',
      category: 'AUTH',
      message: 'account.added',
      payload: { accountId, env: input.env },
    });
    return { ok: true as const, accountId };
  }),

  /**
   * 표시 이름 변경 — UI 라벨용 displayName.
   */
  rename: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        displayName: z.string().max(40).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const r = ctx.activeAccounts.rename(input.accountId, input.displayName);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `이름 변경 실패: ${r.error.kind}`,
        });
      }
      return { ok: true as const };
    }),

  /**
   * 계좌 삭제 — 안전 가드 + 자동 전환/로그아웃:
   *   - lots(OPEN) 가 1행이라도 남아있으면 거부 (포지션 데이터 보호).
   *   - 삭제 대상이 활성 계좌인 경우:
   *       · 다른 계좌가 존재하면 그 중 첫 번째로 활성 전환 (env 도 동기).
   *       · 유일 계좌였다면 env/active 를 모두 null 로 내려 자동 로그아웃.
   *   - credentials 는 항상 함께 제거.
   */
  delete: publicProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const target = ctx.activeAccounts.getById(input.accountId);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '대상 계좌를 찾을 수 없습니다' });
      }
      // 1) lots 가드 — 포지션이 있으면 거부.
      const lotRows = ctx.db
        .select({ id: lotsTable.id })
        .from(lotsTable)
        .where(and(eq(lotsTable.accountId, input.accountId), eq(lotsTable.status, 'OPEN')))
        .limit(1)
        .all();
      if (lotRows.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '보유 차수가 남아있어 삭제할 수 없습니다.',
        });
      }
      // 2) 활성 계좌 삭제라면 자동 전환 대상 선택.
      const wasActive = ctx.activeAccountId === input.accountId;
      const nextCandidate = wasActive
        ? ctx.activeAccounts.list().find((a) => a.id !== input.accountId) ?? null
        : null;
      if (wasActive && nextCandidate) {
        const switchResult = ctx.activeAccounts.setActiveAccountId(nextCandidate.id);
        if (switchResult.isOk()) {
          ctx.setActiveAccountId(nextCandidate.id);
          if (ctx.currentEnv !== nextCandidate.env) {
            ctx.setCurrentEnv(nextCandidate.env);
            ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, nextCandidate.env);
          }
        }
      }
      // 3) credentials 우선 정리 (계좌 행이 사라지면 고아 행).
      ctx.credentialsRepo.clearCredentials(input.accountId);
      const r = ctx.activeAccounts.remove(input.accountId);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: `계좌 삭제 실패: ${r.error.kind}`,
        });
      }
      // 4) 유일 계좌였으면 전역 세션 해제 (로그아웃 + LAST_ACTIVE_ENV 제거).
      const loggedOut = wasActive && !nextCandidate;
      if (loggedOut) {
        ctx.setActiveAccountId(null);
        ctx.setCurrentEnv(null);
        ctx.settingsRepo.delete(SETTING_KEYS.LAST_ACTIVE_ENV);
      }
      ctx.logger.log({
        level: 'WARN',
        category: 'AUTH',
        message: 'account.deleted',
        payload: {
          accountId: input.accountId,
          wasActive,
          nextActiveAccountId: nextCandidate?.id ?? null,
          loggedOut,
        },
      });
      return {
        ok: true as const,
        wasActive,
        loggedOut,
        nextActiveAccountId: nextCandidate?.id ?? null,
      };
    }),

  getBalance: authedProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      }
      const accountId = resolveAccountId(ctx, input ?? {});
      const credResult = ctx.credentialsRepo.loadCredentials(accountId);
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
        accountId: z.number().int().positive().optional(),
        includeSold: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const snap = ctx.lotsRepo.snapshot(accountId, input.pdno);
      if (snap.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `차수 조회 실패: ${snap.error.kind}`,
        });
      }
      const active = ctx.strategyRepo.getActive(accountId, input.pdno);
      const globalActive = ctx.strategyRepo.getActive(accountId, null);
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

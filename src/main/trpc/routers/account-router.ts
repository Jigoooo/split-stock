import type { Balance, BrokerError, KisError } from '@shared/contracts';
import { CredentialsSchema } from '@shared/contracts';
import { buildLotOverlay, type LotOverlaySnapshot } from '@shared/trading/lot-overlay';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { lots as lotsTable } from '../../db/schema';
import { SETTING_KEYS } from '../../db/settings-repo';
import { buildLotSyncMismatches } from '../../trading/current-state-sync';
import type { LotStatus } from '../../trading/fsm';
import type { LotSnapshotEntry } from '../../trading/lots-repo';
import { resolveAccountId } from '../router-helpers';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

/**
 * 도메인 Balance → 기존 KIS BalanceResult shape (renderer wire compat).
 * Stage 8 까지 renderer 가 `position.code` 필드를 기대하므로 broker port
 * 응답을 back-convert.
 */
function toLegacyBalance(b: Balance) {
  return {
    positions: b.positions.map((h) => ({
      code: h.symbol,
      name: h.name,
      qty: h.qty,
      avgPrice: h.avgPrice,
      currentPrice: h.currentPrice,
      evalAmount: h.evalAmount,
      pnlAmount: h.pnlAmount,
      pnlRate: h.pnlRate,
    })),
    deposit: b.deposit,
    d2Deposit: b.d2Deposit,
    totalEval: b.totalEval,
    estimatedAsset: b.estimatedAsset,
  };
}

/**
 * BrokerError → KisError shape (renderer balanceErrorMessage 함수가 KisError 형태
 * 가정). Stage 8 에서 renderer 를 BrokerError 로 전환 시 본 어댑터 제거.
 */
function toLegacyKisError(e: BrokerError): KisError {
  const kind: KisError['kind'] =
    e.kind === 'BUSINESS' ? 'API_BUSINESS' : e.kind === 'NOT_IMPLEMENTED' ? 'UNKNOWN' : e.kind;
  return {
    kind,
    msg: e.msg,
    ...(e.raw?.code !== undefined && { rt_cd: e.raw.code }),
    ...(e.raw?.subCode !== undefined && { msg_cd: e.raw.subCode }),
    ...(e.cause !== undefined && { cause: e.cause }),
  };
}

/**
 * KIS error.cause 는 unknown — http-client 가 { status, body } 객체나 Error 를 그대로 전달.
 * 로그 payload 에 안전하게 직렬화 (Error 는 message 만, 그 외는 원형 유지).
 */
function serializeCause(cause: unknown): unknown {
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  return cause;
}

/**
 * KIS 잔고조회 실패 → 사용자 친화 한국어 메시지로 변환.
 * 원인 정보(rt_cd / msg / status)는 호출측에서 ctx.logger 로 전체 dump (운영 디버깅용).
 * 상세 진단 힌트(HTTP status, kis msg_cd, rt_cd)를 메시지 끝에 덧붙여 즉시 원인 식별 가능.
 */
function balanceDiagnostic(e: KisError): string {
  const parts: string[] = [];
  const cause = e.cause as { status?: number; body?: string } | undefined;
  if (cause?.status !== undefined) parts.push(`HTTP ${cause.status}`);
  if (e.rt_cd) parts.push(`rt_cd=${e.rt_cd}`);
  if (e.msg_cd) parts.push(`msg_cd=${e.msg_cd}`);
  // e.msg 가 "HTTP 500" 처럼 cause.status 와 중복되는 상용구면 생략
  if (e.msg && !/^HTTP \d+$/.test(e.msg) && e.msg !== 'fetch failed') {
    parts.push(e.msg);
  }
  // KIS 가 5xx/비즈니스에도 body 에 JSON 에러({rt_cd, msg1, msg_cd})를 실어주는 경우가 있음 —
  // 첫 200자 그대로 붙여 사용자가 원 메시지를 볼 수 있게.
  if (cause?.body) {
    const trimmed = cause.body.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 0) parts.push(`body=${trimmed.slice(0, 160)}`);
  }
  return parts.length > 0 ? ` [${parts.join(' · ')}]` : '';
}

function balanceErrorMessage(e: KisError): string {
  const diag = balanceDiagnostic(e);
  switch (e.kind) {
    case 'NETWORK':
      return `잔고 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.${diag}`;
    case 'RATE_LIMITED':
      return `잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.${diag}`;
    case 'AUTH_FAILED':
      return `토큰이 만료되었거나 자격증명이 잘못되었습니다. 다시 로그인 해주세요.${diag}`;
    case 'VALIDATION':
      return `잔고 응답 형식이 예상과 다릅니다. KIS 공지를 확인해주세요.${diag}`;
    case 'API_BUSINESS':
      return `${e.msg || '잔고조회 중 오류가 발생했습니다.'}${diag}`;
    default:
      return `잔고조회에 실패했습니다.${diag}`;
  }
}

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

  syncCurrentState: authedProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const activeAccountId = ctx.activeAccountId;
      if (activeAccountId === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '활성 계좌가 없습니다.',
        });
      }
      if (input?.accountId !== undefined && input.accountId !== activeAccountId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '다른 계좌 상태는 수동 동기화할 수 없습니다.',
        });
      }
      if (!ctx.currentStateSync) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'currentStateSync가 초기화되지 않았습니다.',
        });
      }
      return { ok: true as const, ...ctx.currentStateSync.trigger('manual') };
    }),

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
      // 3) factory 상태 원자 교체 — accountId 와 env 를 동시에 교체해 "새 accountId
      //    + 이전 env" 중간 상태 윈도우 제거. 이 간극에 돌아가는 tRPC 쿼리가 PROD URL
      //    로 MOCK 자격증명을 보내거나 그 반대로 보내 AUTH_FAILED 유발하는 레이스 방지.
      const prevEnv = ctx.currentEnv;
      ctx.setEnvAndAccount({ env: target.env, accountId: input.accountId });
      if (prevEnv !== target.env) {
        ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, target.env);
      }
      ctx.logger.log({
        level: target.env === 'PROD' ? 'WARN' : 'INFO',
        category: 'AUTH',
        message: 'account.active.changed',
        payload: { accountId: input.accountId, env: target.env, prevEnv },
      });
      ctx.currentStateSync?.trigger('account-switch');
      return {
        ok: true as const,
        accountId: input.accountId,
        env: target.env,
      };
    }),

  /**
   * 신규 계좌 추가 — 자격증명 저장 + accounts upsert 를 한 번에.
   * `auth.setCredentials` 와 동등한 흐름. 활성 계좌는 변경하지 않는다 (UX 일관성).
   *
   * displayName 은 선택. 비어 있으면 client 의 formatAccountLabel 이
   * `[BROKER] ENV · last4` 자동 라벨 fallback 처리.
   */
  add: publicProcedure
    .input(
      CredentialsSchema.extend({
        displayName: z.string().trim().min(1).max(20).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
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
      if (input.displayName !== undefined && input.displayName.length > 0) {
        const renameResult = ctx.activeAccounts.rename(accountId, input.displayName);
        if (renameResult.isErr()) {
          // rename 실패는 등록 자체를 막지 않음 — 사용자가 나중에 인라인 편집으로 재시도 가능.
          ctx.logger.log({
            level: 'WARN',
            category: 'AUTH',
            message: 'account.rename.failed',
            payload: { accountId, displayName: input.displayName },
          });
        }
      }
      // 첫 계좌면 upsertFromCredentials 가 자동 활성화 — 컨텍스트에 반영.
      const activeNow = ctx.activeAccounts.getActiveAccountId();
      if (activeNow !== null && ctx.activeAccountId !== activeNow) {
        // 원자 교체 — env/accountId 레이스 방지.
        const nextEnv = ctx.currentEnv !== input.env ? input.env : ctx.currentEnv;
        ctx.setEnvAndAccount({ env: nextEnv, accountId: activeNow });
        if (ctx.currentEnv !== input.env) {
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
        ? (ctx.activeAccounts.list().find((a) => a.id !== input.accountId) ?? null)
        : null;
      if (wasActive && nextCandidate) {
        const switchResult = ctx.activeAccounts.setActiveAccountId(nextCandidate.id);
        if (switchResult.isOk()) {
          // 원자 교체 — env/accountId 레이스 방지.
          const prevEnv = ctx.currentEnv;
          ctx.setEnvAndAccount({ env: nextCandidate.env, accountId: nextCandidate.id });
          if (prevEnv !== nextCandidate.env) {
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
        ctx.setEnvAndAccount({ env: null, accountId: null });
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
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = resolveAccountId(ctx, input ?? {});
      const broker = ctx.brokerForAccount(accountId);
      if (!broker) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: '자격증명 없음 — 로그인 필요',
        });
      }
      let r = await broker.inquireBalance();
      // 서버측 조기 무효화(EGW00123 등) 감지 시 토큰 강제 재발급 후 1회 재시도.
      if (r.isErr() && (r.error.kind === 'AUTH_FAILED' || r.error.raw?.subCode === 'EGW00123')) {
        broker.invalidateSession();
        const ensured = await broker.ensureSession({ forceRefresh: true });
        if (ensured.isOk()) {
          r = await broker.inquireBalance();
        }
      }
      if (r.isErr()) {
        const legacy = toLegacyKisError(r.error);
        ctx.logger.log({
          level: 'ERROR',
          category: 'SYS',
          message: 'account.getBalance.failed',
          payload: {
            accountId,
            env,
            brokerId: broker.brokerId,
            kind: legacy.kind,
            kisMsg: legacy.msg,
            rt_cd: legacy.rt_cd,
            msg_cd: legacy.msg_cd,
            cause: serializeCause(legacy.cause),
          },
        });
        throw new TRPCError({
          code: legacy.kind === 'AUTH_FAILED' ? 'UNAUTHORIZED' : 'INTERNAL_SERVER_ERROR',
          message: balanceErrorMessage(legacy),
        });
      }
      return toLegacyBalance(r.value);
    }),

  /**
   * 잔고 + 차수(lots) + 종목별 전략 메타를 1-roundtrip 으로 합성.
   *
   * 반환:
   *   - positions: 기존 getBalance 와 동일 (KIS inquire-balance)
   *   - deposit/d2Deposit/totalEval/estimatedAsset: KIS 요약 raw 값
   *   - totalBuyAmount/totalPnlAmount/totalPnlRate: 요약 바 파생 값
   *   - lotsByPdno: Record<pdno, LotSnapshotEntry[]> — open/buying lot 만 (실시간 차수)
   *   - strategiesByPdno: Record<pdno, { maxStages, autoBuyEnabled, autoSellEnabled }>
   *
   * 호출측은 KIS HTTP 1회 + DB 조회 N회를 분산 호출하지 않고 단일 요청으로 끝낼 수 있다.
   * 기존 getBalance 는 호환성 유지(별도 procedure).
   */
  getBalanceWithLots: authedProcedure
    .input(z.object({ accountId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = resolveAccountId(ctx, input ?? {});
      const broker = ctx.brokerForAccount(accountId);
      if (!broker) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: '자격증명 없음 — 로그인 필요',
        });
      }
      let balanceR = await broker.inquireBalance();
      if (
        balanceR.isErr() &&
        (balanceR.error.kind === 'AUTH_FAILED' || balanceR.error.raw?.subCode === 'EGW00123')
      ) {
        broker.invalidateSession();
        const ensured = await broker.ensureSession({ forceRefresh: true });
        if (ensured.isOk()) {
          balanceR = await broker.inquireBalance();
        }
      }
      if (balanceR.isErr()) {
        const legacy = toLegacyKisError(balanceR.error);
        ctx.logger.log({
          level: 'ERROR',
          category: 'SYS',
          message: 'account.getBalanceWithLots.failed',
          payload: {
            accountId,
            env,
            brokerId: broker.brokerId,
            kind: legacy.kind,
            kisMsg: legacy.msg,
            rt_cd: legacy.rt_cd,
            msg_cd: legacy.msg_cd,
            cause: serializeCause(legacy.cause),
          },
        });
        throw new TRPCError({
          code: legacy.kind === 'AUTH_FAILED' ? 'UNAUTHORIZED' : 'INTERNAL_SERVER_ERROR',
          message: balanceErrorMessage(legacy),
        });
      }
      const balance = { value: toLegacyBalance(balanceR.value) };
      // open/buying lot 조회 (per-account 격리) — 한 번의 select 로 모든 종목 조회 후 group.
      // DB 조회 실패 시 빈 객체로 fallback — 잔고 표시는 계속.
      let lotsByPdno: Record<string, LotSnapshotEntry[]> = {};
      try {
        const lotRows = ctx.db
          .select()
          .from(lotsTable)
          .where(
            and(eq(lotsTable.accountId, accountId), inArray(lotsTable.status, ['OPEN', 'BUYING'])),
          )
          .all();
        for (const r of lotRows) {
          const entry: LotSnapshotEntry = {
            nth: r.nth,
            buyPrice: r.buyPrice,
            qty: r.qty,
            amountKrw: r.amountKrw,
            status: r.status as LotStatus,
            boughtAt: r.boughtAt instanceof Date ? r.boughtAt.getTime() : Number(r.boughtAt),
          };
          const soldAtMs =
            r.soldAt === null
              ? undefined
              : r.soldAt instanceof Date
                ? r.soldAt.getTime()
                : Number(r.soldAt);
          if (soldAtMs !== undefined) entry.soldAt = soldAtMs;
          if (r.sellPrice !== null) entry.sellPrice = r.sellPrice;
          const list = lotsByPdno[r.pdno] ?? [];
          list.push(entry);
          lotsByPdno[r.pdno] = list;
        }
      } catch (err) {
        ctx.logger.log({
          level: 'ERROR',
          category: 'SYS',
          message: 'getBalanceWithLots: lots DB 조회 실패 — 빈 lots 로 fallback',
          payload: { accountId, err: String(err) },
        });
        lotsByPdno = {};
      }
      // 각 pdno 의 active strategy: 종목별 → 글로벌 → 없음. UI가 즉시 사용 가능한
      // 최소 메타(maxStages + 자동매수/자동매도 상태)만 반환.
      // strategyRepo 오류 시 빈 객체로 fallback — 잔고 표시는 계속.
      let strategiesByPdno: Record<
        string,
        { maxStages: number; autoBuyEnabled: boolean; autoSellEnabled: boolean }
      > = {};
      try {
        const globalActive = ctx.strategyRepo.getActive(accountId, null);
        const globalProfile = globalActive.isOk() ? globalActive.value : null;
        // positions + lotsByPdno 의 모든 pdno 합집합 — 잔고는 있으나 lot 없는 종목도 포함.
        const allPdnos = new Set<string>([
          ...balance.value.positions.map((p) => p.code),
          ...Object.keys(lotsByPdno),
        ]);
        for (const pdno of allPdnos) {
          const perSymbol = ctx.strategyRepo.getActive(accountId, pdno);
          const profile =
            perSymbol.isOk() && perSymbol.value !== null ? perSymbol.value : globalProfile;
          if (profile !== null) {
            strategiesByPdno[pdno] = {
              maxStages: profile.maxStages,
              autoBuyEnabled: profile.autoBuyEnabled,
              autoSellEnabled: profile.autoSellEnabled,
            };
          }
        }
      } catch (err) {
        ctx.logger.log({
          level: 'ERROR',
          category: 'SYS',
          message: 'getBalanceWithLots: strategy 조회 실패 — 빈 strategies 로 fallback',
          payload: { accountId, err: String(err) },
        });
        strategiesByPdno = {};
      }
      const mismatches = buildLotSyncMismatches({
        positions: balance.value.positions.map((position) => ({
          code: position.code,
          qty: position.qty,
        })),
        lotsByPdno,
      });
      const totalBuyAmount = balance.value.positions.reduce(
        (sum, position) => sum + position.qty * position.avgPrice,
        0,
      );
      const totalPnlAmount = balance.value.positions.reduce(
        (sum, position) => sum + position.pnlAmount,
        0,
      );
      const totalPnlRate = totalBuyAmount > 0 ? (totalPnlAmount / totalBuyAmount) * 100 : 0;
      return {
        positions: balance.value.positions,
        deposit: balance.value.deposit,
        d2Deposit: balance.value.d2Deposit,
        totalEval: balance.value.totalEval,
        estimatedAsset: balance.value.estimatedAsset,
        totalBuyAmount,
        totalPnlAmount,
        totalPnlRate,
        lotsByPdno,
        syncStatus: mismatches.length > 0 ? 'MISMATCH' : 'IN_SYNC',
        mismatches,
        strategiesByPdno,
      };
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
      const profitPctByNth: Record<number, number> = {};
      for (const rule of profile?.sellRules ?? []) {
        profitPctByNth[rule.nth] = rule.targetProfitPct;
      }
      const overlay: LotOverlaySnapshot[] = snap.value.lots.map((l) => ({
        nth: l.nth,
        buyPrice: l.buyPrice,
        qty: l.qty,
        status: l.status,
      }));
      const lines = buildLotOverlay(overlay, {
        profitPctByNth,
        fallbackProfitPct: 0.05,
        includeSold: input.includeSold,
      });
      return { lines, profitPctByNth };
    }),
});

import { AppEnvSchema, CredentialsSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { clearImportedFlag, needsCredentialsReentry } from '../../backup/backup';
import { SETTING_KEYS } from '../../db/settings-repo';
import { publicProcedure, router } from '../trpc-core';

export const authRouter = router({
  /**
   * 현재 활성 환경(MOCK/PROD) + 활성 계좌 조회.
   */
  getEnv: publicProcedure.query(({ ctx }) => ({
    env: ctx.currentEnv,
    accountId: ctx.activeAccountId,
  })),

  /**
   * 활성 환경 전환 — env 에 매칭되는 자격증명/계좌가 모두 있어야 한다.
   * 성공 시 lastActiveEnv 영속 + 활성 계좌도 그 env 의 첫 계좌로 자동 전환.
   */
  setEnv: publicProcedure.input(AppEnvSchema).mutation(({ ctx, input }) => {
    const cred = ctx.credentialsRepo.loadCredentialsByEnv(input);
    if (cred.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `자격증명 로드 실패: ${cred.error.kind}`,
      });
    }
    if (!cred.value) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `${input} 환경의 자격증명이 저장되어 있지 않습니다`,
      });
    }
    const prev = ctx.currentEnv;
    // ── 레이스 방지: env/accountId 가 어긋난 중간 상태가 관측되지 않도록 모든 선결
    // 조건(계좌 해석 + DB 단일성 트랜잭션)을 먼저 끝낸 뒤 factory 상태를 원자 교체.
    const accId = ctx.credentialsRepo.resolveAccountIdByEnv(input);
    if (accId !== null) {
      const r = ctx.activeAccounts.setActiveAccountId(accId);
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `활성 계좌 전환 실패: ${r.error.kind}`,
        });
      }
    }
    ctx.setEnvAndAccount({ env: input, accountId: accId });
    ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, input);
    ctx.logger.log({
      level: input === 'PROD' ? 'WARN' : 'INFO',
      category: 'AUTH',
      message: input === 'PROD' ? 'env.switch-to-prod' : 'env.switch-to-mock',
      payload: { from: prev, to: input, accountId: accId },
    });
    ctx.currentStateSync?.trigger('env-switch');
    // 로그인 직후 종목 마스터가 비어있거나 24h 초과면 백그라운드 동기화.
    void ctx.stockMasterSync.syncIfStaleWithLog(ctx.logger);
    return { env: input, accountId: accId };
  }),

  /**
   * 로그아웃 — 현재 환경 비활성화. 자격증명은 기본 보존(재로그인 시 재입력 불필요).
   * clearStored:true로 호출하면 해당 env 자격증명도 DB에서 삭제.
   */
  logout: publicProcedure
    .input(z.object({ clearStored: z.boolean().default(false) }).default({ clearStored: false }))
    .mutation(({ ctx, input }) => {
      const current = ctx.currentEnv;
      if (current && input.clearStored) {
        const r = ctx.credentialsRepo.clearCredentialsByEnv(current);
        if (r.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '자격증명 삭제 실패',
          });
        }
      }
      ctx.setCurrentEnv(null);
      ctx.settingsRepo.delete(SETTING_KEYS.LAST_ACTIVE_ENV);
      return { ok: true as const };
    }),

  /**
   * 자격증명 저장 — safeStorage 암호화 후 SQLite BLOB.
   * 절차:
   *   1) ActiveAccountRepo.upsertFromCredentials 로 (env, accountNo8, accountProdCd) 키의
   *      계좌를 찾거나 생성. 첫 계좌면 자동 활성화.
   *   2) credentials 를 해당 accountId 에 저장.
   * 성공 시 해당 env 로 자동 전환하지 않음. 명시적 setEnv 필요.
   */
  setCredentials: publicProcedure.input(CredentialsSchema).mutation(({ ctx, input }) => {
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
      const kind = r.error.kind;
      throw new TRPCError({
        code: kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
        message: `자격증명 저장 실패: ${kind}`,
      });
    }
    // 부팅 시점 활성 계좌가 null 이었다면 첫 등록으로 활성화되었을 수 있다 — 컨텍스트에 반영.
    const activeNow = ctx.activeAccounts.getActiveAccountId();
    if (activeNow !== null && ctx.activeAccountId !== activeNow) {
      ctx.setActiveAccountId(activeNow);
    }
    // 복원 직후 재입력이라면 안내 플래그 자동 해제.
    if (needsCredentialsReentry(ctx.settingsRepo)) {
      clearImportedFlag(ctx.settingsRepo, ctx.logger);
    }
    return { ok: true as const, accountId };
  }),

  /**
   * 저장된 자격증명이 있는 env 리스트 (마스킹된 미리보기).
   * 한 env 당 정확히 1개 (UNIQUE INDEX 보장).
   */
  listStored: publicProcedure.query(({ ctx }) => {
    // Stage 5b-1: broker 단위로 격리된 entries 반환. KIS/KIWOOM 모두 노출.
    const entries = ctx.credentialsRepo.listEntries();
    const result: Array<{
      env: 'MOCK' | 'PROD';
      broker: 'KIS' | 'KIWOOM';
      accountNo8: string;
      accountId: number;
    }> = [];
    for (const entry of entries) {
      const cred = ctx.credentialsRepo.loadCredentials(entry.accountId);
      if (cred.isOk() && cred.value) {
        result.push({
          env: entry.env,
          broker: entry.broker,
          accountNo8: cred.value.accountNo8,
          accountId: entry.accountId,
        });
      }
    }
    return { entries: result };
  }),

  /**
   * 특정 env의 자격증명 삭제. UNIQUE INDEX 로 해당 env 의 단일 계좌 자격증명만 제거.
   */
  clearCredentials: publicProcedure
    .input(z.object({ env: AppEnvSchema }))
    .mutation(({ ctx, input }) => {
      const r = ctx.credentialsRepo.clearCredentialsByEnv(input.env);
      if (r.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '자격증명 삭제 실패',
        });
      }
      if (ctx.currentEnv === input.env) ctx.setCurrentEnv(null);
      return { ok: true as const };
    }),
});

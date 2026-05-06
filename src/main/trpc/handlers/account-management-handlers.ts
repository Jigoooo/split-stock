import { type CredentialsSchema, getCredentialsAccountRef } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { repairAccountFromStoredCredentials } from '../../account/repair-stored-accounts';
import { cryptoOrders as cryptoOrdersTable, lots as lotsTable } from '../../db/schema';
import { SETTING_KEYS } from '../../db/settings-repo';
import type { Context } from '../context';
import { listAccountsWithActiveRepair } from './account-shared';

type AddAccountInput = z.infer<typeof CredentialsSchema> & { displayName?: string | undefined };

export function getActiveAccountHandler(ctx: Context) {
  const { activeAccountId } = listAccountsWithActiveRepair(ctx);
  return {
    accountId: activeAccountId,
    account: activeAccountId !== null ? ctx.activeAccounts.getById(activeAccountId) : null,
  };
}

export function syncCurrentStateHandler(
  ctx: Context,
  input: { accountId?: number | undefined } = {},
) {
  const activeAccountId = ctx.activeAccountId;
  if (activeAccountId === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다.',
    });
  }
  if (input.accountId !== undefined && input.accountId !== activeAccountId) {
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
}

export function setActiveAccountHandler(ctx: Context, input: { accountId: number }) {
  let target = ctx.activeAccounts.getById(input.accountId);
  if (!target) {
    repairAccountFromStoredCredentials(ctx, input.accountId);
    target = ctx.activeAccounts.getById(input.accountId);
  }
  if (!target) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '대상 계좌를 찾을 수 없습니다' });
  }
  const r = ctx.activeAccounts.setActiveAccountId(input.accountId);
  if (r.isErr()) {
    throw new TRPCError({
      code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `활성 계좌 변경 실패: ${r.error.kind}`,
    });
  }
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
}

export function addAccountHandler(ctx: Context, input: AddAccountInput) {
  const accountRef = getCredentialsAccountRef(input);
  const accountResult = ctx.activeAccounts.upsertFromCredentials({
    env: input.env,
    broker: input.broker,
    accountNo8: accountRef.accountNo8,
    accountProdCd: accountRef.accountProdCd,
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
      ctx.logger.log({
        level: 'WARN',
        category: 'AUTH',
        message: 'account.rename.failed',
        payload: { accountId, displayName: input.displayName },
      });
    }
  }
  let envSwitched = false;
  const activeNow = ctx.activeAccounts.getActiveAccountId();
  if (activeNow !== null && ctx.activeAccountId !== activeNow) {
    const prevEnv = ctx.currentEnv;
    const nextEnv = ctx.currentEnv !== input.env ? input.env : ctx.currentEnv;
    ctx.setEnvAndAccount({ env: nextEnv, accountId: activeNow });
    if (prevEnv !== input.env) {
      ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, input.env);
      envSwitched = true;
    }
  }
  ctx.logger.log({
    level: 'INFO',
    category: 'AUTH',
    message: 'account.added',
    payload: { accountId, env: input.env, broker: input.broker, envSwitched },
  });
  return { ok: true as const, accountId, env: input.env, envSwitched };
}

export function renameAccountHandler(
  ctx: Context,
  input: { accountId: number; displayName: string | null },
) {
  const r = ctx.activeAccounts.rename(input.accountId, input.displayName);
  if (r.isErr()) {
    throw new TRPCError({
      code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `이름 변경 실패: ${r.error.kind}`,
    });
  }
  return { ok: true as const };
}

export function reorderAccountsHandler(ctx: Context, input: { orderedIds: number[] }) {
  const r = ctx.activeAccounts.reorder(input.orderedIds);
  if (r.isErr()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `정렬 변경 실패: ${r.error.kind}`,
    });
  }
  return { ok: true as const };
}

export function deleteAccountHandler(ctx: Context, input: { accountId: number }) {
  const target = ctx.activeAccounts.getById(input.accountId);
  if (!target) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '대상 계좌를 찾을 수 없습니다' });
  }
  const lotRows = ctx.db
    .select({ id: lotsTable.id })
    .from(lotsTable)
    .where(
      and(
        eq(lotsTable.broker, target.broker),
        eq(lotsTable.accountId, input.accountId),
        eq(lotsTable.status, 'OPEN'),
      ),
    )
    .limit(1)
    .all();
  if (lotRows.length > 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '보유 차수가 남아있어 삭제할 수 없습니다.',
    });
  }
  if (target.broker === 'UPBIT') {
    const openCryptoOrders = ctx.db
      .select({ id: cryptoOrdersTable.id })
      .from(cryptoOrdersTable)
      .where(
        and(eq(cryptoOrdersTable.accountId, input.accountId), eq(cryptoOrdersTable.state, 'wait')),
      )
      .limit(1)
      .all();
    if (openCryptoOrders.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '미체결 코인 주문이 남아있어 삭제할 수 없습니다.',
      });
    }
  }
  const wasActive = ctx.activeAccountId === input.accountId;
  const nextCandidate = wasActive
    ? (ctx.activeAccounts.list().find((a) => a.id !== input.accountId) ?? null)
    : null;
  if (wasActive && nextCandidate) {
    const switchResult = ctx.activeAccounts.setActiveAccountId(nextCandidate.id);
    if (switchResult.isOk()) {
      const prevEnv = ctx.currentEnv;
      ctx.setEnvAndAccount({ env: nextCandidate.env, accountId: nextCandidate.id });
      if (prevEnv !== nextCandidate.env) {
        ctx.settingsRepo.set(SETTING_KEYS.LAST_ACTIVE_ENV, nextCandidate.env);
      }
    }
  }
  ctx.credentialsRepo.clearCredentials(input.accountId);
  const r = ctx.activeAccounts.remove(input.accountId);
  if (r.isErr()) {
    throw new TRPCError({
      code: r.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `계좌 삭제 실패: ${r.error.kind}`,
    });
  }
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
}

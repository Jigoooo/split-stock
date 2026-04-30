import { TRPCError } from '@trpc/server';
import { readWatchGlobalEnabled, watchGlobalEnabledKey } from '../../db/settings-repo';
import type { Context } from '../context';
import {
  type AccountScopedInput,
  ensureActiveAccountId,
  ensureRequestedAccount,
  ensureWatchEngine,
  getOwnedWatchOrder,
  type IdInput,
  logWatchEvent,
  type SetGlobalEnabledInput,
} from './watch-handler-shared';

export function getWatchControlState(ctx: Context, input: AccountScopedInput | undefined) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const accountId = ensureRequestedAccount(
    activeAccountId,
    input?.accountId,
    '다른 계좌의 자동감시 상태는 조회할 수 없습니다.',
  );
  const orders = watchEngine.list({ accountId });
  const watchingCount = orders.filter((order) => order.status === 'WATCHING').length;
  const pausedCount = orders.filter((order) => order.status === 'PAUSED').length;
  return {
    globalEnabled: readWatchGlobalEnabled(ctx.settingsRepo, accountId),
    watchingCount,
    pausedCount,
    totalTrackedCount: watchingCount + pausedCount,
  };
}

export function setWatchGlobalEnabled(ctx: Context, input: SetGlobalEnabledInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const accountId = ensureRequestedAccount(
    activeAccountId,
    input.accountId,
    '다른 계좌의 자동감시 상태는 변경할 수 없습니다.',
  );
  ctx.settingsRepo.set(watchGlobalEnabledKey(accountId), input.enabled ? 'true' : 'false');
  watchEngine.setGlobalEnabled(accountId, input.enabled);
  ctx.logger.log({
    level: 'INFO',
    category: 'WATCH',
    message: `watch.global.${input.enabled ? 'on' : 'off'}`,
    payload: { accountId },
  });
  return { globalEnabled: input.enabled };
}

export function pauseWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  const result = watchEngine.pause(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `일시중지 실패: ${result.error.kind}`,
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
}

export function resumeWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  getOwnedWatchOrder(ctx, input.id, activeAccountId);
  const result = watchEngine.resume(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `재개 실패: ${result.error.kind}`,
    });
  }
  logWatchEvent(ctx, {
    level: 'INFO',
    message: 'watch.resumed',
    accountId: result.value.accountId,
    watchId: result.value.id,
    pdno: result.value.pdno,
    source: result.value.source,
  });
  return { order: result.value };
}

export function cancelWatchOrder(ctx: Context, input: IdInput) {
  const watchEngine = ensureWatchEngine(ctx);
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  const owned = getOwnedWatchOrder(ctx, input.id, activeAccountId);
  if (owned.source === 'PREBUY' && owned.sourceRefId) {
    const prebuyId = Number(owned.sourceRefId);
    if (Number.isInteger(prebuyId) && prebuyId > 0) {
      ctx.prebuyRepo.cancel(prebuyId);
    }
  }
  const result = watchEngine.cancel(input.id);
  if (result.isErr()) {
    throw new TRPCError({
      code: result.error.kind === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message: `취소 실패: ${result.error.kind}`,
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
}

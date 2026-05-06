import { TRPCError } from '@trpc/server';
import {
  type LotRow,
  type LotsRepoError,
  lotsRepoErrorMessage,
  type ManualEditResult,
} from '../../trading/lots-repo';

export const ACTOR_DEFAULT = 'manual-edit-mode';

type UndoKey = string;

interface UndoEntry {
  accountId: number;
  pdno: string;
  fullSnapshot: LotRow[];
  appliedAt: number;
  action: string;
}

const undoStore = new Map<UndoKey, UndoEntry>();

function undoKeyOf(accountId: number, pdno: string): UndoKey {
  return `${accountId}::${pdno}`;
}

export function captureUndo(
  accountId: number,
  pdno: string,
  snapshot: LotRow[],
  action: string,
): void {
  undoStore.set(undoKeyOf(accountId, pdno), {
    accountId,
    pdno,
    fullSnapshot: snapshot,
    appliedAt: Date.now(),
    action,
  });
}

export function takeUndo(accountId: number, pdno: string): UndoEntry | null {
  return undoStore.get(undoKeyOf(accountId, pdno)) ?? null;
}

export function deleteUndo(accountId: number, pdno: string): void {
  undoStore.delete(undoKeyOf(accountId, pdno));
}

export function getUndoMeta(accountId: number, pdno: string) {
  return undoStore.get(undoKeyOf(accountId, pdno)) ?? null;
}

/** 테스트 셋업용 — 모든 undo 엔트리 초기화. */
export function clearManualUndoStore(): void {
  undoStore.clear();
}

export function assertSafetyOff(
  ctx: { safetyRegistry: { get: (id: number) => { getSnapshot: () => { master: boolean } } } },
  accountId: number,
): void {
  const snap = ctx.safetyRegistry.get(accountId).getSnapshot();
  if (snap.master) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AUTO_TRADING_MUST_BE_OFF: 자동매매를 OFF 한 후 수동편집을 진행하세요.',
    });
  }
}

export function repoErrorToTrpc(e: LotsRepoError): TRPCError {
  switch (e.kind) {
    case 'NOT_FOUND':
      return new TRPCError({ code: 'NOT_FOUND', message: lotsRepoErrorMessage(e) });
    case 'CONFLICT':
      return new TRPCError({ code: 'CONFLICT', message: lotsRepoErrorMessage(e) });
    case 'NO_HISTORY':
      return new TRPCError({ code: 'PRECONDITION_FAILED', message: lotsRepoErrorMessage(e) });
    case 'DB_ERROR':
      return new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: lotsRepoErrorMessage(e),
      });
    case 'INVALID_ACCOUNT':
      return new TRPCError({
        code: 'BAD_REQUEST',
        message: lotsRepoErrorMessage(e),
      });
  }
}

export function logManualEdit(
  ctx: {
    logger: {
      log: (entry: {
        level: 'INFO' | 'WARN' | 'ERROR';
        category: 'FSM' | 'SYS' | 'AUTH' | 'ORDER' | 'WS' | 'BALANCE';
        message: string;
        payload?: Record<string, unknown>;
        audit?: Record<string, unknown>;
      }) => void;
    };
  },
  message: string,
  payload: Record<string, unknown>,
  audit: Record<string, unknown>,
): void {
  ctx.logger.log({
    level: 'INFO',
    category: 'FSM',
    message,
    payload,
    audit,
  });
}

export function triggerBackup(
  ctx: {
    backupScheduler: { triggerNow: (reason: string) => void } | null;
  },
  reason: string,
): void {
  if (ctx.backupScheduler) {
    try {
      ctx.backupScheduler.triggerNow(reason);
    } catch {
      // 백업 실패는 변경을 막지 않음 — 로그만.
    }
  }
}

export function postChange(
  ctx: Parameters<typeof logManualEdit>[0] & Parameters<typeof triggerBackup>[0],
  accountId: number,
  pdno: string,
  result: ManualEditResult,
  message: string,
  extraAudit: Record<string, unknown>,
): void {
  captureUndo(accountId, pdno, result.fullSnapshot, message);
  logManualEdit(
    ctx,
    message,
    { accountId, pdno, actor: ACTOR_DEFAULT },
    {
      ...extraAudit,
      before: result.before,
      after: result.after,
      baselineCount: result.fullSnapshot.length,
    },
  );
  triggerBackup(ctx, message);
}

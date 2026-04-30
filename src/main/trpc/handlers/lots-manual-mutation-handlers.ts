import { TRPCError } from '@trpc/server';
import type { LotRow } from '../../trading/lots-repo';
import type { Context } from '../context';
import { requireAccountId } from '../router-helpers';
import {
  ACTOR_DEFAULT,
  assertSafetyOff,
  captureUndo,
  deleteUndo,
  getUndoMeta,
  logManualEdit,
  postChange,
  repoErrorToTrpc,
  takeUndo,
  triggerBackup,
} from './lots-manual-helpers';

export function enterManualModeHandler(
  ctx: Context,
  input: { accountId: number; confirm: 'EDIT' },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  logManualEdit(
    ctx,
    'lots.manual.mode.enter',
    { accountId, actor: ACTOR_DEFAULT },
    { confirm: input.confirm, ts: Date.now() },
  );
  return { ok: true as const };
}

export function insertManualLotHandler(
  ctx: Context,
  input: {
    accountId: number;
    pdno: string;
    nth: number;
    buyPrice: number;
    qty: number;
    amountKrw?: number | undefined;
    status: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING';
    boughtAtMs: number;
  },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const amountKrw = input.amountKrw ?? input.buyPrice * input.qty;
  const result = ctx.lotsRepo.manualInsert({
    accountId,
    pdno: input.pdno,
    nth: input.nth,
    buyPrice: input.buyPrice,
    qty: input.qty,
    amountKrw,
    status: input.status,
    boughtAt: new Date(input.boughtAtMs),
  });
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  postChange(ctx, accountId, input.pdno, result.value, 'lots.manual.insert', {
    action: 'insert',
    nth: input.nth,
  });
  return { ok: true as const, after: result.value.after };
}

export function updateManualLotHandler(
  ctx: Context,
  input: {
    accountId: number;
    pdno: string;
    lotId: number;
    changes: {
      buyPrice?: number | undefined;
      qty?: number | undefined;
      amountKrw?: number | undefined;
      status?: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING' | undefined;
      boughtAtMs?: number | undefined;
      soldAtMs?: number | null | undefined;
      sellPrice?: number | null | undefined;
      nth?: number | undefined;
    };
  },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const c = input.changes;
  const repoChanges: Parameters<typeof ctx.lotsRepo.manualUpdate>[2] = {};
  if (c.buyPrice !== undefined) repoChanges.buyPrice = c.buyPrice;
  if (c.qty !== undefined) repoChanges.qty = c.qty;
  if (c.amountKrw !== undefined) repoChanges.amountKrw = c.amountKrw;
  if (c.status !== undefined) repoChanges.status = c.status;
  if (c.nth !== undefined) repoChanges.nth = c.nth;
  if (c.boughtAtMs !== undefined) repoChanges.boughtAt = new Date(c.boughtAtMs);
  if (c.soldAtMs !== undefined) {
    repoChanges.soldAt = c.soldAtMs === null ? null : new Date(c.soldAtMs);
  }
  if (c.sellPrice !== undefined) repoChanges.sellPrice = c.sellPrice;
  const result = ctx.lotsRepo.manualUpdate(accountId, input.lotId, repoChanges);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  postChange(ctx, accountId, input.pdno, result.value, 'lots.manual.update', {
    action: 'update',
    lotId: input.lotId,
  });
  return { ok: true as const, after: result.value.after };
}

export function deleteManualLotHandler(
  ctx: Context,
  input: { accountId: number; pdno: string; lotId: number },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const result = ctx.lotsRepo.manualDelete(accountId, input.lotId);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  postChange(ctx, accountId, input.pdno, result.value, 'lots.manual.delete', {
    action: 'delete',
    lotId: input.lotId,
  });
  return { ok: true as const };
}

export function moveManualLotHandler(
  ctx: Context,
  input: {
    accountId: number;
    pdno: string;
    lotId: number;
    newNth: number;
  },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const result = ctx.lotsRepo.manualMove(accountId, input.lotId, input.newNth);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  postChange(ctx, accountId, input.pdno, result.value, 'lots.manual.move', {
    action: 'move',
    lotId: input.lotId,
    newNth: input.newNth,
  });
  return { ok: true as const };
}

export function applyStockSplitRatioHandler(
  ctx: Context,
  input: {
    accountId: number;
    pdno: string;
    ratioPct: number;
  },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const result = ctx.lotsRepo.applyStockSplitRatio(accountId, input.pdno, input.ratioPct);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  captureUndo(accountId, input.pdno, result.value.before, 'lots.manual.applyStockSplitRatio');
  logManualEdit(
    ctx,
    'lots.manual.applyStockSplitRatio',
    { accountId, pdno: input.pdno, actor: ACTOR_DEFAULT },
    {
      action: 'applyStockSplitRatio',
      ratioPct: input.ratioPct,
      before: result.value.before,
      after: result.value.after,
    },
  );
  triggerBackup(ctx, 'lots.manual.applyStockSplitRatio');
  return { ok: true as const, before: result.value.before, after: result.value.after };
}

export function undoManualLotHandler(ctx: Context, input: { accountId: number; pdno: string }) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const entry = takeUndo(accountId, input.pdno);
  if (!entry) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'NO_HISTORY: 직전 변경 기록이 없습니다.',
    });
  }
  const result = ctx.lotsRepo.restoreFromSnapshot(accountId, input.pdno, entry.fullSnapshot);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  deleteUndo(accountId, input.pdno);
  logManualEdit(
    ctx,
    'lots.manual.undo',
    { accountId, pdno: input.pdno, actor: ACTOR_DEFAULT },
    {
      action: 'undo',
      undidAction: entry.action,
      restored: result.value.restored,
    },
  );
  triggerBackup(ctx, 'lots.manual.undo');
  return { ok: true as const, restored: result.value.restored };
}

export function canUndoManualLotHandler(input: { accountId: number; pdno: string }) {
  const accountId = requireAccountId(input);
  const entry = getUndoMeta(accountId, input.pdno);
  if (!entry) return { available: false as const };
  return {
    available: true as const,
    appliedAt: entry.appliedAt,
    action: entry.action,
    baselineCount: entry.fullSnapshot.length,
  };
}

export type CsvBaseline = LotRow[];

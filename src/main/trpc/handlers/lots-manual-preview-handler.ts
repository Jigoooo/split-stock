import { TRPCError } from '@trpc/server';
import type { LotRow } from '../../trading/lots-repo';
import type { Context } from '../context';
import { requireAccountId } from '../router-helpers';
import { repoErrorToTrpc } from './lots-manual-helpers';

export function previewLotsManualChange(
  ctx: Context,
  input: {
    accountId: number;
    pdno: string;
    action:
      | {
          kind: 'insert';
          row: {
            nth: number;
            buyPrice: number;
            qty: number;
            amountKrw?: number | undefined;
            status: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING';
            boughtAtMs: number;
          };
        }
      | { kind: 'update'; lotId: number; changes: ManualPreviewChanges }
      | { kind: 'delete'; lotId: number }
      | { kind: 'move'; lotId: number; newNth: number }
      | { kind: 'bulkSplit'; ratioPct: number };
  },
) {
  const accountId = requireAccountId(input);
  const currentResult = ctx.lotsRepo.listRows(accountId, input.pdno);
  if (currentResult.isErr()) throw repoErrorToTrpc(currentResult.error);
  const current = currentResult.value;
  const next: LotRow[] = current.map((r) => ({ ...r }));

  switch (input.action.kind) {
    case 'insert':
      applyPreviewInsert(next, accountId, input.pdno, input.action.row);
      break;
    case 'update':
      applyPreviewUpdate(next, input.action.lotId, input.action.changes);
      break;
    case 'delete':
      removePreviewLot(next, input.action.lotId);
      break;
    case 'move':
      movePreviewLot(next, input.action.lotId, input.action.newNth);
      break;
    case 'bulkSplit':
      applyPreviewSplit(next, input.action.ratioPct);
      break;
  }

  return {
    before: { rows: current, ...summary(current) },
    after: { rows: next, ...summary(next) },
  };
}

interface ManualPreviewChanges {
  buyPrice?: number | undefined;
  qty?: number | undefined;
  amountKrw?: number | undefined;
  status?: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING' | undefined;
  boughtAtMs?: number | undefined;
  soldAtMs?: number | null | undefined;
  sellPrice?: number | null | undefined;
  nth?: number | undefined;
}

function applyPreviewInsert(
  next: LotRow[],
  accountId: number,
  pdno: string,
  row: {
    nth: number;
    buyPrice: number;
    qty: number;
    amountKrw?: number | undefined;
    status: 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING';
    boughtAtMs: number;
  },
): void {
  if (next.some((x) => x.nth === row.nth)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${row.nth}차 이미 존재`,
    });
  }
  next.push({
    id: -1,
    accountId,
    pdno,
    nth: row.nth,
    buyPrice: row.buyPrice,
    qty: row.qty,
    amountKrw: row.amountKrw ?? row.buyPrice * row.qty,
    status: row.status,
    boughtAt: row.boughtAtMs,
    soldAt: null,
    sellPrice: null,
  });
}

function applyPreviewUpdate(next: LotRow[], lotId: number, changes: ManualPreviewChanges): void {
  const idx = next.findIndex((x) => x.id === lotId);
  if (idx < 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `lot 없음 (id=${lotId})` });
  }
  const target = next[idx];
  if (!target) return;
  next[idx] = {
    ...target,
    buyPrice: changes.buyPrice ?? target.buyPrice,
    qty: changes.qty ?? target.qty,
    amountKrw: changes.amountKrw ?? target.amountKrw,
    status: changes.status ?? target.status,
    boughtAt: changes.boughtAtMs ?? target.boughtAt,
    soldAt: changes.soldAtMs === undefined ? target.soldAt : changes.soldAtMs,
    sellPrice: changes.sellPrice === undefined ? target.sellPrice : changes.sellPrice,
    nth: changes.nth ?? target.nth,
  };
}

function removePreviewLot(next: LotRow[], lotId: number): void {
  const idx = next.findIndex((x) => x.id === lotId);
  if (idx < 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `lot 없음 (id=${lotId})` });
  }
  next.splice(idx, 1);
}

function movePreviewLot(next: LotRow[], lotId: number, newNth: number): void {
  const idx = next.findIndex((x) => x.id === lotId);
  if (idx < 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `lot 없음 (id=${lotId})` });
  }
  const target = next[idx];
  if (!target) return;
  next[idx] = { ...target, nth: newNth };
}

function applyPreviewSplit(next: LotRow[], ratioPct: number): void {
  const multiplier = 1 + ratioPct / 100;
  for (let i = 0; i < next.length; i++) {
    const target = next[i];
    if (!target) continue;
    const newPrice = Math.max(1, Math.round(target.buyPrice * multiplier));
    next[i] = { ...target, buyPrice: newPrice, amountKrw: newPrice * target.qty };
  }
}

function summary(rows: LotRow[]): { totalQty: number; totalCost: number } {
  let qty = 0;
  let cost = 0;
  for (const row of rows) {
    if (row.status === 'OPEN') {
      qty += row.qty;
      cost += row.amountKrw;
    }
  }
  return { totalQty: qty, totalCost: cost };
}

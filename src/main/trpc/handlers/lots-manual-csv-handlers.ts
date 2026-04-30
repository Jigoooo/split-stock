import { TRPCError } from '@trpc/server';
import { lotsToCsv, parseLotsCsv } from '../../trading/lots-csv';
import type { LotRow } from '../../trading/lots-repo';
import type { Context } from '../context';
import { requireAccountId } from '../router-helpers';
import {
  ACTOR_DEFAULT,
  assertSafetyOff,
  captureUndo,
  logManualEdit,
  repoErrorToTrpc,
  triggerBackup,
} from './lots-manual-helpers';

export function importCsvPreviewHandler(input: {
  accountId: number;
  pdno: string;
  csvText: string;
}) {
  const accountId = requireAccountId(input);
  void accountId;
  const result = parseLotsCsv(input.csvText);
  if (result.isErr()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `CSV 파싱 실패: ${result.error}` });
  }
  return result.value;
}

export function importCsvApplyHandler(
  ctx: Context,
  input: { accountId: number; pdno: string; csvText: string },
) {
  const accountId = requireAccountId(input);
  assertSafetyOff(ctx, accountId);
  const parsed = parseLotsCsv(input.csvText);
  if (parsed.isErr()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `CSV 파싱 실패: ${parsed.error}` });
  }
  const validRows = parsed.value.rows.filter((row) => row.ok && row.parsed);
  if (validRows.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '적용 가능한 유효 행이 없습니다.' });
  }
  const beforeSnap = ctx.lotsRepo.listRows(accountId, input.pdno);
  if (beforeSnap.isErr()) throw repoErrorToTrpc(beforeSnap.error);
  const baseline = beforeSnap.value;

  const inserted: LotRow[] = [];
  try {
    for (const row of validRows) {
      if (!row.parsed) continue;
      const result = ctx.lotsRepo.manualInsert({
        accountId,
        pdno: input.pdno,
        ...row.parsed,
      });
      if (result.isErr()) {
        ctx.lotsRepo.restoreFromSnapshot(accountId, input.pdno, baseline);
        throw repoErrorToTrpc(result.error);
      }
      if (result.value.after) inserted.push(result.value.after);
    }
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(e) });
  }
  captureUndo(accountId, input.pdno, baseline, 'lots.manual.importCsvApply');
  logManualEdit(
    ctx,
    'lots.manual.importCsvApply',
    { accountId, pdno: input.pdno, actor: ACTOR_DEFAULT },
    {
      action: 'importCsvApply',
      insertedCount: inserted.length,
      totalParsedRows: parsed.value.rows.length,
    },
  );
  triggerBackup(ctx, 'lots.manual.importCsvApply');
  return { ok: true as const, insertedCount: inserted.length };
}

export function exportCsvHandler(
  ctx: Context,
  input: { accountId: number; pdno?: string | undefined },
) {
  const accountId = requireAccountId(input);
  const result = ctx.lotsRepo.listRows(accountId, input.pdno);
  if (result.isErr()) throw repoErrorToTrpc(result.error);
  return { csv: lotsToCsv(result.value), rowCount: result.value.length };
}

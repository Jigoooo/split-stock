import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { lotsToCsv, parseLotsCsv } from '../../trading/lots-csv';
import {
  type LotRow,
  type LotsRepoError,
  lotsRepoErrorMessage,
  type ManualEditResult,
} from '../../trading/lots-repo';
import { requireAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

/**
 * 차수 수동편집(A7) 라우터.
 *
 * 안전장치 (다중 레이어):
 *  1. 모든 mutation 은 `requireAccountId` — accountId 명시 강제 (read 도 동일).
 *  2. 모든 mutation 은 `assertSafetyOff` — 활성 계좌의 master safety 가 OFF 인지 확인.
 *     ON 상태이면 PRECONDITION_FAILED('AUTO_TRADING_MUST_BE_OFF').
 *  3. apply/import/bulk 모두 단일 트랜잭션 — 중간 실패 시 완전 rollback.
 *  4. 모든 변경은 audit_payload 에 before/after + actor 기록 (event_logs).
 *  5. 변경 후 BackupScheduler.triggerNow() 자동 실행 (실패해도 변경은 유지).
 *  6. Undo: 직전 변경의 fullSnapshot 을 in-memory 로 보관 (계좌+종목 단위 1회).
 */

const ACTOR_DEFAULT = 'manual-edit-mode';

const StatusSchema = z.enum(['OPEN', 'SOLD', 'BUYING', 'SELLING']);

const LotChangesSchema = z.object({
  buyPrice: z.number().int().positive().optional(),
  qty: z.number().int().positive().optional(),
  amountKrw: z.number().int().positive().optional(),
  status: StatusSchema.optional(),
  boughtAtMs: z.number().int().nonnegative().optional(),
  soldAtMs: z.number().int().nonnegative().nullable().optional(),
  sellPrice: z.number().int().positive().nullable().optional(),
  nth: z.number().int().min(1).optional(),
});

const PdnoSchema = z.string().regex(/^\d{6}$/);

/** Undo 보관소 키: `${accountId}::${pdno}` */
type UndoKey = string;

interface UndoEntry {
  accountId: number;
  pdno: string;
  /** 직전 변경 적용 직전의 (accountId, pdno) 전체 차수 스냅샷 — 복원 baseline */
  fullSnapshot: LotRow[];
  /** 변경 시각 (ms) */
  appliedAt: number;
  /** 변경 종류 — UI 표시용 */
  action: string;
}

const undoStore = new Map<UndoKey, UndoEntry>();

function undoKeyOf(accountId: number, pdno: string): UndoKey {
  return `${accountId}::${pdno}`;
}

function captureUndo(accountId: number, pdno: string, snapshot: LotRow[], action: string): void {
  undoStore.set(undoKeyOf(accountId, pdno), {
    accountId,
    pdno,
    fullSnapshot: snapshot,
    appliedAt: Date.now(),
    action,
  });
}

/** 테스트 셋업용 — 모든 undo 엔트리 초기화. */
export function clearManualUndoStore(): void {
  undoStore.clear();
}

function assertSafetyOff(
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

function repoErrorToTrpc(e: LotsRepoError): TRPCError {
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
  }
}

function logManualEdit(
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

function triggerBackup(
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

/**
 * captureRouterUndo — manualEditResult 의 fullSnapshot 을 undo 저장소에 기록하고
 * audit/log/backup 후처리를 일괄 수행. 모든 mutation 의 공통 후처리.
 */
function postChange(
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
      // 전체 baseline 도 포함 — 사후 audit/포렌식 용
      baselineCount: result.fullSnapshot.length,
    },
  );
  triggerBackup(ctx, message);
}

export const lotsManualRouter = router({
  /**
   * 수동편집 모드 진입 — UI 의 2단계 확인이 통과된 직후 호출.
   * 서버측 상태는 보관하지 않음 (UI 로컬 모드 플래그).
   * 수행: master safety OFF 검증 + audit log 기록.
   */
  enterMode: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        confirm: z.literal('EDIT'),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      logManualEdit(
        ctx,
        'lots.manual.mode.enter',
        { accountId, actor: ACTOR_DEFAULT },
        { confirm: input.confirm, ts: Date.now() },
      );
      return { ok: true as const };
    }),

  /**
   * 미리보기 — DB 변경 없이 변경 결과를 가상 적용한 lots 를 반환.
   * UI 가 평가손익/수익률 차이를 표시할 수 있도록.
   */
  preview: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        action: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('insert'),
            row: z.object({
              nth: z.number().int().min(1),
              buyPrice: z.number().int().positive(),
              qty: z.number().int().positive(),
              amountKrw: z.number().int().positive().optional(),
              status: StatusSchema.default('OPEN'),
              boughtAtMs: z.number().int().nonnegative(),
            }),
          }),
          z.object({
            kind: z.literal('update'),
            lotId: z.number().int().positive(),
            changes: LotChangesSchema,
          }),
          z.object({ kind: z.literal('delete'), lotId: z.number().int().positive() }),
          z.object({
            kind: z.literal('move'),
            lotId: z.number().int().positive(),
            newNth: z.number().int().min(1),
          }),
          z.object({
            kind: z.literal('bulkSplit'),
            ratioPct: z.number().min(-99.99).max(1000),
          }),
        ]),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      const currentResult = ctx.lotsRepo.listRows(accountId, input.pdno);
      if (currentResult.isErr()) throw repoErrorToTrpc(currentResult.error);
      const current = currentResult.value;
      const next: LotRow[] = current.map((r) => ({ ...r }));

      switch (input.action.kind) {
        case 'insert': {
          const r = input.action.row;
          if (next.some((x) => x.nth === r.nth)) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `${r.nth}차 이미 존재`,
            });
          }
          next.push({
            id: -1,
            accountId,
            pdno: input.pdno,
            nth: r.nth,
            buyPrice: r.buyPrice,
            qty: r.qty,
            amountKrw: r.amountKrw ?? r.buyPrice * r.qty,
            status: r.status,
            boughtAt: r.boughtAtMs,
            soldAt: null,
            sellPrice: null,
          });
          break;
        }
        case 'update': {
          const action = input.action;
          const idx = next.findIndex((x) => x.id === action.lotId);
          if (idx < 0) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `lot 없음 (id=${action.lotId})`,
            });
          }
          const target = next[idx];
          if (!target) break;
          const c = action.changes;
          next[idx] = {
            ...target,
            buyPrice: c.buyPrice ?? target.buyPrice,
            qty: c.qty ?? target.qty,
            amountKrw: c.amountKrw ?? target.amountKrw,
            status: c.status ?? target.status,
            boughtAt: c.boughtAtMs ?? target.boughtAt,
            soldAt: c.soldAtMs === undefined ? target.soldAt : c.soldAtMs,
            sellPrice: c.sellPrice === undefined ? target.sellPrice : c.sellPrice,
            nth: c.nth ?? target.nth,
          };
          break;
        }
        case 'delete': {
          const action = input.action;
          const idx = next.findIndex((x) => x.id === action.lotId);
          if (idx < 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `lot 없음 (id=${action.lotId})` });
          }
          next.splice(idx, 1);
          break;
        }
        case 'move': {
          const action = input.action;
          const idx = next.findIndex((x) => x.id === action.lotId);
          if (idx < 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `lot 없음 (id=${action.lotId})` });
          }
          const target = next[idx];
          if (!target) break;
          next[idx] = { ...target, nth: action.newNth };
          break;
        }
        case 'bulkSplit': {
          const multiplier = 1 + input.action.ratioPct / 100;
          for (let i = 0; i < next.length; i++) {
            const t = next[i];
            if (!t) continue;
            const newPrice = Math.max(1, Math.round(t.buyPrice * multiplier));
            next[i] = { ...t, buyPrice: newPrice, amountKrw: newPrice * t.qty };
          }
          break;
        }
      }

      const summary = (rows: LotRow[]): { totalQty: number; totalCost: number } => {
        let qty = 0;
        let cost = 0;
        for (const r of rows) {
          if (r.status === 'OPEN') {
            qty += r.qty;
            cost += r.amountKrw;
          }
        }
        return { totalQty: qty, totalCost: cost };
      };

      return {
        before: { rows: current, ...summary(current) },
        after: { rows: next, ...summary(next) },
      };
    }),

  /**
   * 신규 차수 추가.
   */
  insert: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        nth: z.number().int().min(1),
        buyPrice: z.number().int().positive(),
        qty: z.number().int().positive(),
        amountKrw: z.number().int().positive().optional(),
        status: StatusSchema.default('OPEN'),
        boughtAtMs: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const amountKrw = input.amountKrw ?? input.buyPrice * input.qty;
      const r = ctx.lotsRepo.manualInsert({
        accountId,
        pdno: input.pdno,
        nth: input.nth,
        buyPrice: input.buyPrice,
        qty: input.qty,
        amountKrw,
        status: input.status,
        boughtAt: new Date(input.boughtAtMs),
      });
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      postChange(ctx, accountId, input.pdno, r.value, 'lots.manual.insert', {
        action: 'insert',
        nth: input.nth,
      });
      return { ok: true as const, after: r.value.after };
    }),

  /**
   * 차수 수정.
   */
  update: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        lotId: z.number().int().positive(),
        changes: LotChangesSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      // exactOptionalPropertyTypes 호환을 위해 명시적으로 키-별 빌드 (undefined 필드 누락).
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
      const r = ctx.lotsRepo.manualUpdate(accountId, input.lotId, repoChanges);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      postChange(ctx, accountId, input.pdno, r.value, 'lots.manual.update', {
        action: 'update',
        lotId: input.lotId,
      });
      return { ok: true as const, after: r.value.after };
    }),

  /**
   * 차수 삭제.
   * UI 는 "장부상만 변경, KIS 잔고와 불일치 가능" 경고 표시 책임.
   */
  delete: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        lotId: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const r = ctx.lotsRepo.manualDelete(accountId, input.lotId);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      postChange(ctx, accountId, input.pdno, r.value, 'lots.manual.delete', {
        action: 'delete',
        lotId: input.lotId,
      });
      return { ok: true as const };
    }),

  /**
   * 차수 번호 변경.
   */
  move: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        lotId: z.number().int().positive(),
        newNth: z.number().int().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const r = ctx.lotsRepo.manualMove(accountId, input.lotId, input.newNth);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      postChange(ctx, accountId, input.pdno, r.value, 'lots.manual.move', {
        action: 'move',
        lotId: input.lotId,
        newNth: input.newNth,
      });
      return { ok: true as const };
    }),

  /**
   * 액면분할 일괄 보정 — (accountId, pdno) 의 모든 차수 buyPrice 에 ratio 곱.
   */
  applyStockSplitRatio: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        ratioPct: z
          .number()
          .min(-99.99)
          .max(1000)
          .refine((v) => v !== 0, '0% 보정은 무의미'),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const r = ctx.lotsRepo.applyStockSplitRatio(accountId, input.pdno, input.ratioPct);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      // bulk 의 fullSnapshot 은 result.before 자체.
      captureUndo(accountId, input.pdno, r.value.before, 'lots.manual.applyStockSplitRatio');
      logManualEdit(
        ctx,
        'lots.manual.applyStockSplitRatio',
        { accountId, pdno: input.pdno, actor: ACTOR_DEFAULT },
        {
          action: 'applyStockSplitRatio',
          ratioPct: input.ratioPct,
          before: r.value.before,
          after: r.value.after,
        },
      );
      triggerBackup(ctx, 'lots.manual.applyStockSplitRatio');
      return { ok: true as const, before: r.value.before, after: r.value.after };
    }),

  /**
   * Undo — 직전 변경 1회 취소 (계좌+종목 단위).
   */
  undo: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const entry = undoStore.get(undoKeyOf(accountId, input.pdno));
      if (!entry) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_HISTORY: 직전 변경 기록이 없습니다.',
        });
      }
      const r = ctx.lotsRepo.restoreFromSnapshot(accountId, input.pdno, entry.fullSnapshot);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      undoStore.delete(undoKeyOf(accountId, input.pdno));
      logManualEdit(
        ctx,
        'lots.manual.undo',
        { accountId, pdno: input.pdno, actor: ACTOR_DEFAULT },
        {
          action: 'undo',
          undidAction: entry.action,
          restored: r.value.restored,
        },
      );
      triggerBackup(ctx, 'lots.manual.undo');
      return { ok: true as const, restored: r.value.restored };
    }),

  /**
   * Undo 가능 여부 + 직전 변경 메타 조회 — UI 버튼 활성/비활성 결정용.
   */
  canUndo: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
      }),
    )
    .query(({ input }) => {
      const accountId = requireAccountId(input);
      const entry = undoStore.get(undoKeyOf(accountId, input.pdno));
      if (!entry) return { available: false as const };
      return {
        available: true as const,
        appliedAt: entry.appliedAt,
        action: entry.action,
        baselineCount: entry.fullSnapshot.length,
      };
    }),

  /**
   * CSV 미리보기 — 파싱만 (DB 변경 없음).
   */
  importCsvPreview: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        csvText: z.string().min(1).max(1_000_000),
      }),
    )
    .query(({ input }) => {
      const accountId = requireAccountId(input);
      void accountId;
      const r = parseLotsCsv(input.csvText);
      if (r.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `CSV 파싱 실패: ${r.error}` });
      }
      return r.value;
    }),

  /**
   * CSV 적용 — 파싱 → 트랜잭션 일괄 manualInsert.
   * 하나라도 충돌(중복 nth 등)이면 전체 rollback.
   */
  importCsvApply: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema,
        csvText: z.string().min(1).max(1_000_000),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      assertSafetyOff(ctx, accountId);
      const parsed = parseLotsCsv(input.csvText);
      if (parsed.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `CSV 파싱 실패: ${parsed.error}` });
      }
      const validRows = parsed.value.rows.filter((r) => r.ok && r.parsed);
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
          const r = ctx.lotsRepo.manualInsert({
            accountId,
            pdno: input.pdno,
            ...row.parsed,
          });
          if (r.isErr()) {
            // 전체 rollback — 이미 insert 된 행 제거 후 baseline 으로 복원.
            ctx.lotsRepo.restoreFromSnapshot(accountId, input.pdno, baseline);
            throw repoErrorToTrpc(r.error);
          }
          if (r.value.after) inserted.push(r.value.after);
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
    }),

  /**
   * CSV 익스포트 — pdno 미지정 시 전체.
   */
  exportCsv: publicProcedure
    .input(
      z.object({
        accountId: z.number().int().positive(),
        pdno: PdnoSchema.optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = requireAccountId(input);
      const r = ctx.lotsRepo.listRows(accountId, input.pdno);
      if (r.isErr()) throw repoErrorToTrpc(r.error);
      return { csv: lotsToCsv(r.value), rowCount: r.value.length };
    }),
});

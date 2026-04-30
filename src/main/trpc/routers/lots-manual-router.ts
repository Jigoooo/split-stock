import { z } from 'zod';
import {
  exportCsvHandler,
  importCsvApplyHandler,
  importCsvPreviewHandler,
} from '../handlers/lots-manual-csv-handlers';
import { clearManualUndoStore } from '../handlers/lots-manual-helpers';
import {
  applyStockSplitRatioHandler,
  canUndoManualLotHandler,
  deleteManualLotHandler,
  enterManualModeHandler,
  insertManualLotHandler,
  moveManualLotHandler,
  undoManualLotHandler,
  updateManualLotHandler,
} from '../handlers/lots-manual-mutation-handlers';
import { previewLotsManualChange } from '../handlers/lots-manual-preview-handler';
import { authedProcedure, router } from '../trpc-core';

export { clearManualUndoStore };

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
const AccountIdField = z.number().int().positive();

export const lotsManualRouter = router({
  enterMode: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        confirm: z.literal('EDIT'),
      }),
    )
    .mutation(({ ctx, input }) => enterManualModeHandler(ctx, input)),

  preview: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
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
    .query(({ ctx, input }) => previewLotsManualChange(ctx, input)),

  insert: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        nth: z.number().int().min(1),
        buyPrice: z.number().int().positive(),
        qty: z.number().int().positive(),
        amountKrw: z.number().int().positive().optional(),
        status: StatusSchema.default('OPEN'),
        boughtAtMs: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => insertManualLotHandler(ctx, input)),

  update: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        lotId: z.number().int().positive(),
        changes: LotChangesSchema,
      }),
    )
    .mutation(({ ctx, input }) => updateManualLotHandler(ctx, input)),

  delete: authedProcedure
    .input(z.object({ accountId: AccountIdField, pdno: PdnoSchema, lotId: AccountIdField }))
    .mutation(({ ctx, input }) => deleteManualLotHandler(ctx, input)),

  move: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        lotId: AccountIdField,
        newNth: z.number().int().min(1),
      }),
    )
    .mutation(({ ctx, input }) => moveManualLotHandler(ctx, input)),

  applyStockSplitRatio: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        ratioPct: z
          .number()
          .min(-99.99)
          .max(1000)
          .refine((v) => v !== 0, '0% 보정은 무의미'),
      }),
    )
    .mutation(({ ctx, input }) => applyStockSplitRatioHandler(ctx, input)),

  undo: authedProcedure
    .input(z.object({ accountId: AccountIdField, pdno: PdnoSchema }))
    .mutation(({ ctx, input }) => undoManualLotHandler(ctx, input)),

  canUndo: authedProcedure
    .input(z.object({ accountId: AccountIdField, pdno: PdnoSchema }))
    .query(({ input }) => canUndoManualLotHandler(input)),

  importCsvPreview: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        csvText: z.string().min(1).max(1_000_000),
      }),
    )
    .query(({ input }) => importCsvPreviewHandler(input)),

  importCsvApply: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema,
        csvText: z.string().min(1).max(1_000_000),
      }),
    )
    .mutation(({ ctx, input }) => importCsvApplyHandler(ctx, input)),

  exportCsv: authedProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdno: PdnoSchema.optional(),
      }),
    )
    .query(({ ctx, input }) => exportCsvHandler(ctx, input)),
});

import { CredentialsSchema } from '@shared/contracts';
import { z } from 'zod';
import {
  getBalanceHandler,
  getBalanceWithLotsHandler,
  getPositionOverlayHandler,
} from '../handlers/account-balance-handlers';
import {
  addAccountHandler,
  deleteAccountHandler,
  getActiveAccountHandler,
  renameAccountHandler,
  reorderAccountsHandler,
  setActiveAccountHandler,
  syncCurrentStateHandler,
} from '../handlers/account-management-handlers';
import { listAccountsWithActiveRepair } from '../handlers/account-shared';
import { authedProcedure, publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();

export const accountRouter = router({
  listAccounts: publicProcedure.query(({ ctx }) => listAccountsWithActiveRepair(ctx)),

  getActive: publicProcedure.query(({ ctx }) => getActiveAccountHandler(ctx)),

  syncCurrentState: authedProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .mutation(({ ctx, input }) => syncCurrentStateHandler(ctx, input ?? {})),

  setActive: publicProcedure
    .input(z.object({ accountId: AccountIdField }))
    .mutation(({ ctx, input }) => setActiveAccountHandler(ctx, input)),

  add: publicProcedure
    .input(
      z.intersection(
        CredentialsSchema,
        z.object({
          displayName: z.string().trim().min(1).max(20).optional(),
        }),
      ),
    )
    .mutation(({ ctx, input }) => addAccountHandler(ctx, input)),

  rename: publicProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        displayName: z.string().max(40).nullable(),
      }),
    )
    .mutation(({ ctx, input }) => renameAccountHandler(ctx, input)),

  reorder: publicProcedure
    .input(
      z.object({
        orderedIds: z.array(AccountIdField).min(1),
      }),
    )
    .mutation(({ ctx, input }) => reorderAccountsHandler(ctx, input)),

  delete: publicProcedure
    .input(z.object({ accountId: AccountIdField }))
    .mutation(({ ctx, input }) => deleteAccountHandler(ctx, input)),

  getBalance: authedProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(({ ctx, input }) => getBalanceHandler(ctx, input ?? {})),

  getBalanceWithLots: authedProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(({ ctx, input }) => getBalanceWithLotsHandler(ctx, input ?? {})),

  getPositionOverlay: authedProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/),
        accountId: AccountIdField.optional(),
        includeSold: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) => getPositionOverlayHandler(ctx, input)),
});

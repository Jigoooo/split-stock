import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { accountRouter } from './routers/account-router';
import { authRouter } from './routers/auth-router';
import { marketRouter } from './routers/market-router';
import { router } from './trpc-core';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  market: marketRouter,
});

export type AppRouter = typeof appRouter;
export type AppRouterInputs = inferRouterInputs<AppRouter>;
export type AppRouterOutputs = inferRouterOutputs<AppRouter>;

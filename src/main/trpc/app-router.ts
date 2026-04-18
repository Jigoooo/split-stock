import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { accountRouter } from './routers/account-router';
import { authRouter } from './routers/auth-router';
import { backupRouter } from './routers/backup-router';
import { logsRouter } from './routers/logs-router';
import { marketRouter } from './routers/market-router';
import { monitoringRouter } from './routers/monitoring-router';
import { orderRouter } from './routers/order-router';
import { realtimeRouter } from './routers/realtime-router';
import { reportsRouter } from './routers/reports-router';
import { safetyRouter } from './routers/safety-router';
import { strategyRouter } from './routers/strategy-router';
import { router } from './trpc-core';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  market: marketRouter,
  safety: safetyRouter,
  logs: logsRouter,
  strategy: strategyRouter,
  monitoring: monitoringRouter,
  reports: reportsRouter,
  backup: backupRouter,
  realtime: realtimeRouter,
  order: orderRouter,
});

export type AppRouter = typeof appRouter;
export type AppRouterInputs = inferRouterInputs<AppRouter>;
export type AppRouterOutputs = inferRouterOutputs<AppRouter>;

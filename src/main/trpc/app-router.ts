import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { accountRouter } from './routers/account-router';
import { authRouter } from './routers/auth-router';
import { backupRouter } from './routers/backup-router';
import { displayRouter } from './routers/display-router';
import { feesRouter } from './routers/fees-router';
import { logsRouter } from './routers/logs-router';
import { marketRouter } from './routers/market-router';
import { monitoringRouter } from './routers/monitoring-router';
import { notificationsRouter } from './routers/notifications-router';
import { orderRouter } from './routers/order-router';
import { pendingCancelRouter } from './routers/pending-cancel-router';
import { priceCorrectionRouter } from './routers/price-correction-router';
import { protectionRouter } from './routers/protection-router';
import { rateGuardRouter } from './routers/rate-guard-router';
import { realtimeRouter } from './routers/realtime-router';
import { reportsRouter } from './routers/reports-router';
import { safetyRouter } from './routers/safety-router';
import { strategyRouter } from './routers/strategy-router';
import { tradingWindowsRouter } from './routers/trading-windows-router';
import { watchRouter } from './routers/watch-router';
import { router } from './trpc-core';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  backup: backupRouter,
  display: displayRouter,
  fees: feesRouter,
  market: marketRouter,
  safety: safetyRouter,
  logs: logsRouter,
  strategy: strategyRouter,
  monitoring: monitoringRouter,
  notifications: notificationsRouter,
  reports: reportsRouter,
  realtime: realtimeRouter,
  order: orderRouter,
  watch: watchRouter,
  tradingWindows: tradingWindowsRouter,
  rateGuard: rateGuardRouter,
  pendingCancel: pendingCancelRouter,
  protection: protectionRouter,
  priceCorrection: priceCorrectionRouter,
});

export type AppRouter = typeof appRouter;
export type AppRouterInputs = inferRouterInputs<AppRouter>;
export type AppRouterOutputs = inferRouterOutputs<AppRouter>;

import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { accountRouter } from './routers/account-router';
import { aiRouter } from './routers/ai-router';
import { authRouter } from './routers/auth-router';
import { backupRouter } from './routers/backup-router';
import { bootRouter } from './routers/boot-router';
import { catchUpRouter } from './routers/catch-up-router';
import { cryptoMemoRouter } from './routers/crypto-memo-router';
import { cryptoPendingCancelRouter } from './routers/crypto-pending-cancel-router';
import { cryptoRouter } from './routers/crypto-router';
import { displayRouter } from './routers/display-router';
import { feesRouter } from './routers/fees-router';
import { logsRouter } from './routers/logs-router';
import { lotsManualRouter } from './routers/lots-manual-router';
import { lotsRouter } from './routers/lots-router';
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
import { symbolMemoRouter } from './routers/symbol-memo-router';
import { tradingWindowsRouter } from './routers/trading-windows-router';
import { watchRouter } from './routers/watch-router';
import { router } from './trpc-core';

export const appRouter = router({
  boot: bootRouter,
  auth: authRouter,
  catchUp: catchUpRouter,
  account: accountRouter,
  ai: aiRouter,
  backup: backupRouter,
  crypto: cryptoRouter,
  display: displayRouter,
  fees: feesRouter,
  market: marketRouter,
  safety: safetyRouter,
  logs: logsRouter,
  lots: lotsRouter,
  lotsManual: lotsManualRouter,
  strategy: strategyRouter,
  symbolMemo: symbolMemoRouter,
  cryptoMemo: cryptoMemoRouter,
  monitoring: monitoringRouter,
  notifications: notificationsRouter,
  reports: reportsRouter,
  realtime: realtimeRouter,
  order: orderRouter,
  watch: watchRouter,
  tradingWindows: tradingWindowsRouter,
  rateGuard: rateGuardRouter,
  pendingCancel: pendingCancelRouter,
  cryptoPendingCancel: cryptoPendingCancelRouter,
  protection: protectionRouter,
  priceCorrection: priceCorrectionRouter,
});

export type AppRouter = typeof appRouter;
export type AppRouterInputs = inferRouterInputs<AppRouter>;
export type AppRouterOutputs = inferRouterOutputs<AppRouter>;

import type { AppEnv } from '@shared/contracts';
import { and, eq } from 'drizzle-orm';
import type { Timer } from '../brokers/core/types';
import type { Db } from '../db/client';
import { orders } from '../db/schema';
import { readPendingCancelConfig, type SettingsRepo } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import { cancelOrRevise } from '../kis/order';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import { PendingOrderWatcher } from '../trading/pending-order-watcher';
import type { createContextFactory } from '../trpc/context';

type RuntimeContextFactory = ReturnType<typeof createContextFactory>;

export function createPendingCancelWatcher(input: {
  timer: Timer;
  db: Db;
  settingsRepo: SettingsRepo;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  logger: EventLogger;
  factoryRef: { factory: RuntimeContextFactory | null };
}): PendingOrderWatcher {
  const pendingCancelCfg = readPendingCancelConfig(input.settingsRepo);
  let pendingOrderWatcher: PendingOrderWatcher;

  pendingOrderWatcher = new PendingOrderWatcher({
    timer: input.timer,
    timeoutMs: pendingCancelCfg.timeoutMs,
    maxRetries: pendingCancelCfg.maxRetries,
    reorderMode: 'NONE',
    backoffMultiplier: 3,
    backoffMaxFactor: 9,
    onExpire: async (entry, attempt) => {
      const currentCfg = readPendingCancelConfig(input.settingsRepo);
      if (!currentCfg.enabled) {
        input.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'feature_disabled', odno: entry.odno, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const env = input.factoryRef.factory?.getCurrentEnv() ?? null;
      const accountId = entry.accountId ?? input.factoryRef.factory?.getActiveAccountId() ?? null;
      if (!env || !accountId) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'env_or_account_missing', odno: entry.odno, attempt },
        });
        return;
      }
      if (!entry.orgNo) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'orgNo_missing', odno: entry.odno, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const credResult = input.credentialsRepo.loadCredentials(accountId);
      if (credResult.isErr() || !credResult.value) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'credentials_missing', odno: entry.odno, accountId, attempt },
        });
        return;
      }
      const cred = credResult.value;
      if (cred.broker === 'UPBIT') {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'non_stock_account', odno: entry.odno, accountId, attempt },
        });
        return;
      }
      const tokenResult = await input.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'token_failed', odno: entry.odno, attempt },
        });
        pendingOrderWatcher.rearm({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const r = await cancelOrRevise(
        {
          http: input.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
          logger: input.logger,
        },
        {
          action: 'cancel',
          orgOrgNo: entry.orgNo,
          orgOdno: entry.odno,
          division: 'LIMIT',
          qty: entry.qty ?? 0,
          price: 0,
          qtyAllOrder: true,
        },
      );
      if (r.isOk()) {
        input.db
          .update(orders)
          .set({ status: 'CANCELLED' })
          .where(and(eq(orders.odno, entry.odno), eq(orders.accountId, accountId)))
          .run();
        input.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'pending-cancel.success',
          payload: { odno: entry.odno, pdno: entry.pdno, side: entry.side, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      } else {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.failed',
          payload: { odno: entry.odno, kind: r.error.kind, msg: r.error.msg, attempt },
        });
        pendingOrderWatcher.rearm({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      }
    },
    onLimitReached: (entry) => {
      input.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'pending-cancel.limit-reached',
        payload: { odno: entry.odno, pdno: entry.pdno, side: entry.side, nth: entry.nth },
      });
    },
  });

  return pendingOrderWatcher;
}

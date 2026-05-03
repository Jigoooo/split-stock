import { and, eq } from 'drizzle-orm';
import type { Timer } from '../brokers/core/types';
import { UpbitExchangeAdapter } from '../crypto/upbit/adapter';
import type { Db } from '../db/client';
import { cryptoOrders } from '../db/schema';
import { readPendingCancelConfig, type SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import { PendingOrderWatcher } from '../trading/pending-order-watcher';

/**
 * 코인 미체결 자동취소 — UPBIT 지정가 주문 timeout 시 cancelOrder 발사. (RALPLAN P6 A4)
 *
 * stock pending-cancel-runtime 의 코인 어댑터.
 * PendingOrderWatcher 자체는 broker-agnostic 이므로 그대로 재사용,
 * onExpire 콜백만 UPBIT REST cancelOrder 로 분기.
 *
 * 등록 키:
 *   pdno = market (KRW-BTC 등)
 *   side = 'BUY' | 'SELL' (UPBIT 'bid'/'ask' → 표준 BUY/SELL 매핑)
 *   nth  = 동일 (market, side) 동시 등록 분리용 — 코인은 자동매매 차수 또는 placement 시각 ms
 */
export function createCryptoPendingCancelWatcher(input: {
  timer: Timer;
  db: Db;
  settingsRepo: SettingsRepo;
  credentialsRepo: CredentialsRepo;
  logger: EventLogger;
}): PendingOrderWatcher {
  const cfg = readPendingCancelConfig(input.settingsRepo);
  let watcher: PendingOrderWatcher;
  watcher = new PendingOrderWatcher({
    timer: input.timer,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
    reorderMode: 'NONE',
    backoffMultiplier: 3,
    backoffMaxFactor: 9,
    onExpire: async (entry, attempt) => {
      const currentCfg = readPendingCancelConfig(input.settingsRepo);
      if (!currentCfg.enabled) {
        input.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'crypto.pending-cancel.skip',
          payload: { reason: 'feature_disabled', uuid: entry.odno, attempt },
        });
        watcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const accountId = entry.accountId ?? null;
      if (accountId === null) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.pending-cancel.skip',
          payload: { reason: 'account_missing', uuid: entry.odno, attempt },
        });
        return;
      }
      const credResult = input.credentialsRepo.loadCredentials(accountId);
      if (credResult.isErr() || !credResult.value) {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.pending-cancel.skip',
          payload: { reason: 'credentials_missing', uuid: entry.odno, accountId, attempt },
        });
        return;
      }
      const cred = credResult.value;
      if (cred.broker !== 'UPBIT') {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.pending-cancel.skip',
          payload: { reason: 'non_crypto_account', uuid: entry.odno, accountId, attempt },
        });
        return;
      }
      const adapter = new UpbitExchangeAdapter({
        accessKey: cred.accessKey,
        secretKey: cred.secretKey,
      });
      const r = await adapter.cancelOrder({ uuid: entry.odno });
      if (r.isOk()) {
        input.db
          .update(cryptoOrders)
          .set({ state: 'cancel', updatedAt: new Date() })
          .where(and(eq(cryptoOrders.uuid, entry.odno), eq(cryptoOrders.accountId, accountId)))
          .run();
        input.logger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'crypto.pending-cancel.success',
          payload: { uuid: entry.odno, market: entry.pdno, side: entry.side, attempt },
        });
        watcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      } else {
        input.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.pending-cancel.failed',
          payload: { uuid: entry.odno, kind: r.error.kind, msg: r.error.message, attempt },
        });
        watcher.rearm({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      }
    },
    onLimitReached: (entry) => {
      input.logger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'crypto.pending-cancel.limit-reached',
        payload: { uuid: entry.odno, market: entry.pdno, side: entry.side, nth: entry.nth },
      });
    },
  });
  return watcher;
}

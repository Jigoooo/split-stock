import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { protectionLimits } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';
import type { SafetyStateRegistry } from './safety-state';

/**
 * rate-guard 설정 — protection_limits 테이블의 rate_guard_* 컬럼.
 */
export interface RateGuardSettings {
  enabled: boolean;
  windowSeconds: number;
  maxCount: number;
}

export interface RateGuardRepo {
  getSettings(accountId: number): RateGuardSettings;
  updateSettings(
    accountId: number,
    enabled: boolean,
    windowSeconds: number,
    maxCount: number,
  ): void;
}

export function createRateGuardRepo(db: Db): RateGuardRepo {
  return {
    getSettings(accountId) {
      const row = db
        .select({
          rateGuardEnabled: protectionLimits.rateGuardEnabled,
          rateGuardWindowSeconds: protectionLimits.rateGuardWindowSeconds,
          rateGuardMaxCount: protectionLimits.rateGuardMaxCount,
        })
        .from(protectionLimits)
        .where(eq(protectionLimits.accountId, accountId))
        .get();

      if (!row) {
        return { enabled: false, windowSeconds: 40, maxCount: 5 };
      }
      return {
        enabled: row.rateGuardEnabled === 1,
        windowSeconds: row.rateGuardWindowSeconds ?? 40,
        maxCount: row.rateGuardMaxCount ?? 5,
      };
    },

    updateSettings(accountId, enabled, windowSeconds, maxCount) {
      const now = new Date();
      const existing = db
        .select({ accountId: protectionLimits.accountId })
        .from(protectionLimits)
        .where(eq(protectionLimits.accountId, accountId))
        .get();

      if (existing) {
        db.update(protectionLimits)
          .set({
            rateGuardEnabled: enabled ? 1 : 0,
            rateGuardWindowSeconds: windowSeconds,
            rateGuardMaxCount: maxCount,
            updatedAt: now,
          })
          .where(eq(protectionLimits.accountId, accountId))
          .run();
      } else {
        db.insert(protectionLimits)
          .values({
            accountId,
            rateGuardEnabled: enabled ? 1 : 0,
            rateGuardWindowSeconds: windowSeconds,
            rateGuardMaxCount: maxCount,
            updatedAt: now,
          })
          .run();
      }
    },
  };
}

/**
 * 연속매수 방지 — 종목별 매수 카운터.
 * 인메모리 Map: accountId → pdno → timestamp[]
 * 앱 재시작 시 초기화됨 (의도적 — 재시작이 곧 리셋).
 */
export interface RateGuard {
  recordBuy(accountId: number, pdno: string, ts: number): void;
  checkAndPossiblyDisableAuto(accountId: number): { switchedToManual: boolean };
}

export interface CreateRateGuardOptions {
  repo: RateGuardRepo;
  safetyRegistry: SafetyStateRegistry;
  logger: EventLogger;
  now?: () => number;
}

export function createRateGuard(opts: CreateRateGuardOptions): RateGuard {
  const now = opts.now ?? (() => Date.now());
  // accountId → pdno → sorted timestamps (ms)
  const history = new Map<number, Map<string, number[]>>();

  function getAccountHistory(accountId: number): Map<string, number[]> {
    let m = history.get(accountId);
    if (!m) {
      m = new Map();
      history.set(accountId, m);
    }
    return m;
  }

  return {
    recordBuy(accountId, pdno, ts) {
      const acct = getAccountHistory(accountId);
      const arr = acct.get(pdno) ?? [];
      arr.push(ts);
      acct.set(pdno, arr);
    },

    checkAndPossiblyDisableAuto(accountId) {
      const settings = opts.repo.getSettings(accountId);
      if (!settings.enabled) return { switchedToManual: false };

      const windowMs = settings.windowSeconds * 1000;
      const cutoff = now() - windowMs;
      const acct = getAccountHistory(accountId);

      for (const [pdno, timestamps] of acct.entries()) {
        // 윈도우 내 타임스탬프만 필터링
        const recent = timestamps.filter((t) => t >= cutoff);
        acct.set(pdno, recent);

        // N+1회 이상이면 자동매매 수동 전환
        if (recent.length > settings.maxCount) {
          opts.safetyRegistry.get(accountId).setMaster(false);
          opts.logger.log({
            level: 'WARN',
            category: 'SYS',
            message: 'rate_guard.auto_disabled',
            payload: {
              accountId,
              pdno,
              count: recent.length,
              windowSeconds: settings.windowSeconds,
              maxCount: settings.maxCount,
            },
          });
          // 트리거 후 이력 초기화 — 재시작 없이 재활성화 시 즉시 재트리거 방지
          acct.clear();
          return { switchedToManual: true };
        }
      }

      return { switchedToManual: false };
    },
  };
}

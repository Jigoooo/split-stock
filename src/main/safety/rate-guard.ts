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

      // A3: 보수화된 기본값 — 신규 사용자가 명시적으로 끄지 않는 이상 자동매수 폭주 안전망 활성.
      // - enabled=true: 폭주 방지가 기본 ON
      // - windowSeconds=60: 1분 윈도우 (기존 40초보다 길게)
      // - maxCount=3: 1분 내 동일 종목 자동매수 3회 초과 시 자동→수동 전환 (기존 5회보다 보수적)
      if (!row) {
        return { enabled: true, windowSeconds: 60, maxCount: 3 };
      }
      return {
        enabled: row.rateGuardEnabled === 1,
        windowSeconds: row.rateGuardWindowSeconds ?? 60,
        maxCount: row.rateGuardMaxCount ?? 3,
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
  /**
   * 체결 성공 후(post-place) 연속매수 카운터. 키: accountId → pdno → timestamps[].
   *
   * 역할이 다른 두 레이어가 공존한다:
   *  - 이 Map: recordBuy 로 체결 후 카운트하며, 임계 초과 시 account 전체 master=false (nuclear).
   *    broker-agnostic 이라 도메스틱 HTS 와도 공유 (crypto-auto-service, crypto-booster-service, crypto-router).
   *  - CryptoAutoBuyGuard.histories: 매수 시도 직전에 카운트하며, 임계 초과 시 해당 market 만
   *    SELL_ONLY 전환 (surgical).
   *
   * 두 Map 은 시점·키·액션·blast-radius 가 모두 달라 중복이 아니다.
   */
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

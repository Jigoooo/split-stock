import type { AppEnv } from '@shared/contracts';
import type { ActiveAccountRepo } from '../account/active-account';
import type { Db } from '../db/client';
import type { SettingsRepo } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { RealtimeService } from '../realtime/realtime-service';
import type { RateGuardRepo } from '../safety/rate-guard';
import type { SafetyState, SafetyStateRegistry } from '../safety/safety-state';
import type { TimeWindowRepo } from '../safety/time-window';
import type { ProtectionLimitsRepo } from '../safety/protection-limits-repo';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { LotsRepo } from '../trading/lots-repo';
import type { PendingOrderWatcher } from '../trading/pending-order-watcher';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { StockMasterSyncService } from '../trading/stock-master-sync';
import type { StrategyRepo } from '../trading/strategy-repo';
import type { WatchEngine } from '../trading/watch-engine';

export interface Context {
  db: Db;
  credentialsRepo: CredentialsRepo;
  settingsRepo: SettingsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  /**
   * 활성 계좌의 SafetyState — registry.get(activeAccountId).
   * 라우터에서 명시적으로 다른 계좌를 다룰 때는 `safetyRegistry.get(otherId)` 사용.
   */
  safety: SafetyState;
  safetyRegistry: SafetyStateRegistry;
  logger: EventLogger;
  strategyRepo: StrategyRepo;
  stockMasterRepo: StockMasterRepo;
  stockMasterSync: StockMasterSyncService;
  candlesRepo: DailyCandlesRepo;
  lotsRepo: LotsRepo;
  activeAccounts: ActiveAccountRepo;
  /**
   * 활성 계좌 ID — 한 번도 계좌가 등록되지 않으면 null.
   * 라우터는 거래성 mutation 에서 explicit accountId 를 강제하고, 읽기 query 는 이 값을
   * fallback 으로 사용한다.
   */
  activeAccountId: number | null;
  timeWindowRepo: TimeWindowRepo;
  rateGuardRepo: RateGuardRepo;
  protectionLimitsRepo: ProtectionLimitsRepo;
  watchEngine: WatchEngine | null;
  /** 미체결 자동취소(F6) 감시 인스턴스 — 부팅 시 주입, 미활성화 시 null. */
  pendingOrderWatcher: PendingOrderWatcher | null;
  realtime: RealtimeService | null;
  bus: FeedBus | null;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
  setActiveAccountId: (id: number | null) => void;
}

export interface ContextFactoryOptions
  extends Omit<
    Context,
    | 'setCurrentEnv'
    | 'currentEnv'
    | 'realtime'
    | 'safety'
    | 'activeAccountId'
    | 'setActiveAccountId'
  > {
  /** env 전환 시 realtime 재생성을 호출측에 위임. 반환값이 현재 RealtimeService. */
  realtimeFactory?: (env: AppEnv | null) => RealtimeService | null;
  /** 부팅 시 ensureActive 결과로 채울 초기 활성 계좌 ID. */
  initialActiveAccountId?: number | null;
}

export function createContextFactory(opts: ContextFactoryOptions): {
  create: () => Context;
  setEnv: (env: AppEnv | null) => void;
  setActiveAccountId: (id: number | null) => void;
  getRealtime: () => RealtimeService | null;
  getActiveAccountId: () => number | null;
  /** 현재 활성 env. 부트스트랩 외부에서 lazy 로 끌어 쓸 때 사용. */
  getCurrentEnv: () => AppEnv | null;
} {
  const { realtimeFactory, initialActiveAccountId, ...deps } = opts;
  let currentEnv: AppEnv | null = null;
  let activeAccountId: number | null = initialActiveAccountId ?? null;
  let realtime: RealtimeService | null = null;

  const setCurrentEnv = (env: AppEnv | null): void => {
    currentEnv = env;
    if (realtimeFactory) {
      realtime = realtimeFactory(env);
    }
  };
  const setActiveAccountId = (id: number | null): void => {
    activeAccountId = id;
  };

  return {
    create: () => ({
      ...deps,
      get currentEnv() {
        return currentEnv;
      },
      get realtime() {
        return realtime;
      },
      get activeAccountId() {
        return activeAccountId;
      },
      get safety() {
        // activeAccountId 가 null 이면 0 슬롯 사용 — 안전하게 차단된 상태 (master=false 기본값)
        return deps.safetyRegistry.get(activeAccountId ?? 0);
      },
      setCurrentEnv,
      setActiveAccountId,
    }),
    setEnv: setCurrentEnv,
    setActiveAccountId,
    getRealtime: () => realtime,
    getActiveAccountId: () => activeAccountId,
    getCurrentEnv: () => currentEnv,
  };
}

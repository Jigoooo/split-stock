import type { AppEnv } from '@shared/contracts';
import type { ActiveAccountRepo } from '../account/active-account';
import type { BackupScheduler } from '../backup/scheduler';
import type { Db } from '../db/client';
import type { SettingsRepo } from '../db/settings-repo';
import { readWatchGlobalEnabled } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { RealtimeService } from '../realtime/realtime-service';
import type { ProtectionLimitsRepo } from '../safety/protection-limits-repo';
import type { RateGuardRepo } from '../safety/rate-guard';
import type { SafetyState, SafetyStateRegistry } from '../safety/safety-state';
import type { TimeWindowRepo } from '../safety/time-window';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { BalanceSync } from '../trading/balance-sync';
import type { CurrentStateSync } from '../trading/current-state-sync';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { LotsRepo } from '../trading/lots-repo';
import type { PendingOrderWatcher } from '../trading/pending-order-watcher';
import type { PrebuyRepo } from '../trading/prebuy-repo';
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
  currentStateSync: CurrentStateSync | undefined;
  prebuyRepo: PrebuyRepo;
  /** 미체결 자동취소(F6) 감시 인스턴스 — 부팅 시 주입, 미활성화 시 null. */
  pendingOrderWatcher: PendingOrderWatcher | null;
  realtime: RealtimeService | null;
  bus: FeedBus | null;
  /** 차수 수동편집(A7) 등 위험 변경 직후 즉시 백업을 트리거하기 위한 핸들. 부팅 시 주입, 미설정 시 null. */
  backupScheduler: BackupScheduler | null;
  /** 즉시주문 직후 잔고 polling 사이클 stale 윈도우를 줄이기 위한 즉시 갱신 핸들. */
  balanceSync: BalanceSync | null;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
  setActiveAccountId: (id: number | null) => void;
  /**
   * env 전환과 activeAccountId 변경을 원자적으로 수행. env 스위칭 시 개별 setter
   * 를 순차 호출하면 중간 간극에 "새 env + 이전 accountId" 조합이 관측돼
   * PROD URL 로 MOCK 자격증명을 보내는 등 AUTH_FAILED 가 발생하는 레이스를 방지.
   */
  setEnvAndAccount: (next: { env: AppEnv | null; accountId: number | null }) => void;
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
    | 'setEnvAndAccount'
    | 'backupScheduler'
    | 'balanceSync'
    | 'currentStateSync'
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
  /**
   * env 와 activeAccountId 를 원자적으로 교체 — env 전환 시 레이스 방지.
   * 개별 setter 를 순차 호출하면 사이 간극에 돌아가는 tRPC query 가
   * "새 env + 이전 accountId(이전 env 자격증명)" 조합을 잡아 KIS 에
   * 모의투자키를 실전 URL 로 보내는 등 AUTH_FAILED 를 유발한다.
   */
  setEnvAndAccount: (next: { env: AppEnv | null; accountId: number | null }) => void;
  setBackupScheduler: (scheduler: BackupScheduler | null) => void;
  setBalanceSync: (sync: BalanceSync | null) => void;
  setCurrentStateSync: (sync: CurrentStateSync | null) => void;
  getRealtime: () => RealtimeService | null;
  getActiveAccountId: () => number | null;
  /** 현재 활성 env. 부트스트랩 외부에서 lazy 로 끌어 쓸 때 사용. */
  getCurrentEnv: () => AppEnv | null;
} {
  const { realtimeFactory, initialActiveAccountId, ...deps } = opts;
  let currentEnv: AppEnv | null = null;
  let activeAccountId: number | null = initialActiveAccountId ?? null;
  let realtime: RealtimeService | null = null;
  let backupScheduler: BackupScheduler | null = null;
  let balanceSync: BalanceSync | null = null;
  let currentStateSync: CurrentStateSync | null = null;

  const syncWatchEngine = (accountId: number | null): void => {
    deps.watchEngine?.setActiveAccountId(accountId);
    if (accountId !== null) {
      deps.watchEngine?.setGlobalEnabled(
        accountId,
        readWatchGlobalEnabled(deps.settingsRepo, accountId),
      );
    }
  };

  const setCurrentEnv = (env: AppEnv | null): void => {
    currentEnv = env;
    if (realtimeFactory) {
      realtime = realtimeFactory(env);
    }
  };
  const setActiveAccountId = (id: number | null): void => {
    activeAccountId = id;
    syncWatchEngine(id);
  };
  const setEnvAndAccount = (next: { env: AppEnv | null; accountId: number | null }): void => {
    // JS single-threaded 이므로 동일 tick 내 두 closure var 업데이트는 외부에서 관측 시 원자.
    // accountId 를 먼저 세팅해 "새 env + 이전 accountId" 조합 윈도우 자체를 없앤다.
    activeAccountId = next.accountId;
    currentEnv = next.env;
    syncWatchEngine(next.accountId);
    if (realtimeFactory) {
      realtime = realtimeFactory(next.env);
    }
  };
  const setBackupScheduler = (scheduler: BackupScheduler | null): void => {
    backupScheduler = scheduler;
  };
  const setBalanceSync = (sync: BalanceSync | null): void => {
    balanceSync = sync;
  };
  const setCurrentStateSync = (sync: CurrentStateSync | null): void => {
    currentStateSync = sync;
  };

  syncWatchEngine(activeAccountId);

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
      get backupScheduler() {
        return backupScheduler;
      },
      get balanceSync() {
        return balanceSync;
      },
      get currentStateSync() {
        return currentStateSync ?? undefined;
      },
      setCurrentEnv,
      setActiveAccountId,
      setEnvAndAccount,
    }),
    setEnv: setCurrentEnv,
    setActiveAccountId,
    setEnvAndAccount,
    setBackupScheduler,
    setBalanceSync,
    setCurrentStateSync,
    getRealtime: () => realtime,
    getActiveAccountId: () => activeAccountId,
    getCurrentEnv: () => currentEnv,
  };
}

import type { AppEnv } from '@shared/contracts';
import type { ActiveAccountRepo } from '../account/active-account';
import type { AiCredentialsRepo } from '../ai/ai-credentials-repo';
import type { DartClient } from '../ai/dart-client';
import type { DartCorpCodeRepo } from '../ai/dart-corp-code-repo';
import type { LlmClient } from '../ai/llm-client';
import type { MarketContextService } from '../ai/market-context-service';
import type { NewsFetcher } from '../ai/news-fetcher';
import type { BackupScheduler } from '../backup/scheduler';
import { createBrokerPort } from '../brokers/factory';
import { KisRealtimeAdapter } from '../brokers/kis/realtime-adapter';
import { KiwoomAuth } from '../brokers/kiwoom/auth';
import type { KiwoomHttpClient } from '../brokers/kiwoom/http-client';
import { KiwoomSocketClient } from '../brokers/kiwoom/socket-client';
import type { KiwoomTokenStore } from '../brokers/kiwoom/token-store';
import type { BrokerPort } from '../brokers/ports/broker-port';
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
import type { StrategyExecutionEngine } from '../trading/strategy-execution-engine';
import type { StrategyRepo } from '../trading/strategy-repo';
import type { WatchEngine } from '../trading/watch-engine';

export interface Context {
  db: Db;
  credentialsRepo: CredentialsRepo;
  settingsRepo: SettingsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  /** Kiwoom REST 클라이언트 (env 별). 사용자가 Kiwoom 자격증명을 등록하지 않으면
   *  미사용. */
  kiwoomHttpByEnv: Record<AppEnv, KiwoomHttpClient>;
  kiwoomTokenStore: KiwoomTokenStore;
  /** Kiwoom WS 인스턴스 빌더 — 동일 (env, account) 에서는 1개 인스턴스 재사용.
   *  KiwoomAdapter 가 RealtimePort 구현 시 사용. Stage 6.5 라이브 검증 시 주입. */
  kiwoomWsFactory: ((env: AppEnv) => unknown) | null;
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
  strategyEngine: StrategyExecutionEngine | null;
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
  /** AI provider 키 저장소 — 없으면 AI 라우터가 비활성. */
  aiCredentialsRepo: AiCredentialsRepo | null;
  /** AI LLM 호출 추상 클라이언트. */
  llmClient: LlmClient | null;
  /** OpenDART REST 클라이언트 — Phase 2 strategy 추천 시 공시 컨텍스트 보강. 키 미설정 시 isAvailable=false. */
  dartClient: DartClient | null;
  /** DART corp_code 매핑 저장소 — stock_code(6) → corp_code(8). 30일 캐시. */
  dartCorpCodeRepo: DartCorpCodeRepo | null;
  /** KRX/ECOS 캐시 기반 시장 컨텍스트 — 키 미설정/캐시 없음이면 status 로 graceful fallback. */
  marketContextService: MarketContextService | null;
  /** Naver Open API 뉴스 fetcher — AI 추천 시 종목별 최신 뉴스 컨텍스트. 키 미설정 시 isAvailable=false. */
  newsFetcher: NewsFetcher | null;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
  setActiveAccountId: (id: number | null) => void;
  /**
   * env 전환과 activeAccountId 변경을 원자적으로 수행. env 스위칭 시 개별 setter
   * 를 순차 호출하면 중간 간극에 "새 env + 이전 accountId" 조합이 관측돼
   * PROD URL 로 MOCK 자격증명을 보내는 등 AUTH_FAILED 가 발생하는 레이스를 방지.
   */
  setEnvAndAccount: (next: { env: AppEnv | null; accountId: number | null }) => void;
  /**
   * 활성/특정 계좌의 BrokerPort 인스턴스를 반환.
   *
   * - accountId 의 credentials 가 없거나 currentEnv 와 mismatch 면 null 반환
   * - broker 인스턴스는 (brokerId, env, accountId) 단위로 캐시되어 동일 요청 묶음에서 재사용
   * - env 전환 시 캐시 자동 무효화 (setEnvAndAccount/setCurrentEnv 가 clear)
   *
   * Stage 3 시점에서는 routers/trading 이 본 메서드를 점진 도입.
   * Stage 4 까지 KIS 만 지원, Stage 6 부터 Kiwoom 분기.
   */
  brokerForAccount: (accountId: number) => BrokerPort | null;
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
    | 'brokerForAccount'
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
  /**
   * 현재 활성 계좌의 BrokerPort. trading/realtime 백그라운드 모듈이
   * env/account 전환에 자동 반응하기 위해 lazy getter 로 노출.
   * activeAccountId 가 null 이거나 자격증명 미준비/env mismatch 면 null.
   */
  getBroker: () => BrokerPort | null;
} {
  const { realtimeFactory, initialActiveAccountId, ...deps } = opts;
  let currentEnv: AppEnv | null = null;
  let activeAccountId: number | null = initialActiveAccountId ?? null;
  let realtime: RealtimeService | null = null;
  let backupScheduler: BackupScheduler | null = null;
  let balanceSync: BalanceSync | null = null;
  let currentStateSync: CurrentStateSync | null = null;

  /**
   * Broker adapter 캐시 — key = `${env}:${accountId}`.
   * env 전환 또는 setEnvAndAccount 시 clear.
   */
  const brokerCache = new Map<string, BrokerPort>();
  const clearBrokerCache = (): void => {
    for (const port of brokerCache.values()) port.dispose();
    brokerCache.clear();
  };
  /**
   * KIS RealtimePort 어댑터 — context lifetime 동안 단일 인스턴스 (모든 broker 가
   * 같은 RealtimeService + FeedBus 를 공유). bus 가 미준비(env 미선택) 면 미생성.
   */
  let kisRealtimeAdapter: KisRealtimeAdapter | null = null;
  const ensureRealtimeAdapter = (): KisRealtimeAdapter | undefined => {
    if (kisRealtimeAdapter) return kisRealtimeAdapter;
    if (!deps.bus) return undefined;
    kisRealtimeAdapter = new KisRealtimeAdapter({
      getService: () => realtime,
      bus: deps.bus,
    });
    return kisRealtimeAdapter;
  };
  const brokerForAccount = (accountId: number): BrokerPort | null => {
    if (!currentEnv) return null;
    const key = `${currentEnv}:${accountId}`;
    const cached = brokerCache.get(key);
    if (cached) return cached;
    const credResult = deps.credentialsRepo.loadCredentials(accountId);
    if (credResult.isErr() || !credResult.value) return null;
    const cred = credResult.value;
    if (cred.env !== currentEnv) return null;

    let port: BrokerPort;
    if (cred.broker === 'KIWOOM') {
      // Kiwoom: env 별 http + 계좌별 auth + 단일 socket(필요 시).
      const auth = new KiwoomAuth({
        env: currentEnv,
        appKey: cred.appKey,
        // CredentialsSchema 의 appSecret 을 Kiwoom 의 secretKey 로 사용
        secretKey: cred.appSecret,
      });
      const socket = new KiwoomSocketClient({
        env: currentEnv,
        getToken: () => null, // Stage 6.5 라이브 시 cachedToken 노출 hook 추가 가능
        // realtimeFactory ws (deps.kiwoomWsFactory) 가 없으면 socket 미작동.
        // 라이브 라이트 검증 시 main/index.ts 에서 wsFactory 주입 (Stage 6.5)
        factory: ((url: string) => {
          throw new Error(`Kiwoom WS factory not wired (env=${currentEnv}, url=${url})`);
        }) as never,
      });
      port = createBrokerPort({
        brokerId: 'KIWOOM',
        deps: {
          env: currentEnv,
          auth,
          http: deps.kiwoomHttpByEnv[currentEnv],
          tokenStore: deps.kiwoomTokenStore,
          credentials: {
            appKey: cred.appKey,
            secretKey: cred.appSecret,
            accountNo: `${cred.accountNo8}${cred.accountProdCd}`,
          },
          socket,
        },
      });
    } else {
      const realtimeAdapter = ensureRealtimeAdapter();
      port = createBrokerPort({
        brokerId: 'KIS',
        deps: {
          env: currentEnv,
          httpByEnv: deps.httpByEnv,
          authService: deps.auth,
          credentials: {
            appKey: cred.appKey,
            appSecret: cred.appSecret,
            accountNo8: cred.accountNo8,
            accountProdCd: cred.accountProdCd,
          },
          logger: deps.logger,
          ...(realtimeAdapter !== undefined && { realtime: realtimeAdapter }),
        },
      });
    }
    brokerCache.set(key, port);
    return port;
  };

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
    clearBrokerCache();
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
    clearBrokerCache();
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
      brokerForAccount,
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
    getBroker: () => (activeAccountId !== null ? brokerForAccount(activeAccountId) : null),
  };
}

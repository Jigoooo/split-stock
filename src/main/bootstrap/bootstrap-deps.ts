import { join } from 'node:path';
import type { AppEnv } from '@shared/contracts';
import WebSocket from 'ws';
import { ActiveAccountRepo } from '../account/active-account';
import { repairAccountFromStoredCredentials } from '../account/repair-stored-accounts';
import { AiCredentialsRepo } from '../ai/ai-credentials-repo';
import { DartClient } from '../ai/dart-client';
import { DartCorpCodeRepo } from '../ai/dart-corp-code-repo';
import { EcosClient } from '../ai/ecos-client';
import { KrxClient } from '../ai/krx-client';
import { LlmClient } from '../ai/llm-client';
import { MarketContextRepo } from '../ai/market-context-repo';
import { MarketContextService } from '../ai/market-context-service';
import { NaverDatalabClient } from '../ai/naver-datalab-client';
import { NewsFetcher } from '../ai/news-fetcher';
import { BootStatusService } from '../boot/boot-status';
import { KiwoomHttpClient } from '../brokers/kiwoom/http-client';
import { KIWOOM_BASE_URL } from '../brokers/kiwoom/metadata/endpoints';
import { KiwoomTokenStore } from '../brokers/kiwoom/token-store';
import { defaultDbPath, migrate, openDb } from '../db/client';
import {
  repairAccountsRuntimeSchema,
  repairMarketContextRuntimeSchema,
  repairTradingCalendarRuntimeSchema,
} from '../db/runtime-schema-repair';
import {
  readSafetyMaster,
  SETTING_KEYS,
  SettingsRepo,
  writeSafetyMaster,
} from '../db/settings-repo';
import { app, dialog, isDev, safeStorage } from '../electron-runtime';
import { broadcastToAllWindows } from '../ipc/app-shell-ipc';
import { AuthService } from '../kis/auth';
import { KIS_BASE_URL } from '../kis/endpoints';
import { KisHttpClient } from '../kis/http-client';
import { TokenStore } from '../kis/token-store';
import type { WsFactory, WsLike } from '../kis/ws-client';
import {
  cleanupOldEventLogs,
  createApiFailureLogger,
  createEventLogger,
  splitErrorLogger,
  teeLoggers,
} from '../logging/event-logger';
import { createFileLogger } from '../logging/file-logger';
// Sentry 일시 비활성화 — 향후 빌드 환경변수 방식으로 재활성화 예정.
// import { initSentryFromSettings } from '../monitoring/sentry';
import { notifyTrade, notifyWatchOutcome } from '../notification/trade-notifier';
import { configureStartupPerf, markStartup } from '../perf/startup-perf';
import { createAccountSyncRuntime } from '../runtime/account-sync-runtime';
import { createTradingRuntime } from '../runtime/trading-runtime';
import { createWatchEventDispatchers } from '../runtime/watch-events';
import { ProtectionGuard } from '../safety/protection-guard';
import { ProtectionLimitsRepo } from '../safety/protection-limits-repo';
import { createRateGuardRepo } from '../safety/rate-guard';
import { SafetyStateRegistry } from '../safety/safety-state';
import { createTimeWindowRepo } from '../safety/time-window';
import { CredentialsRepo } from '../security/credentials-repo';
import { DailyCandlesRepo } from '../trading/daily-candles-repo';
import { LotsRepo } from '../trading/lots-repo';
import { PrebuyRepo } from '../trading/prebuy-repo';
import { StockMasterRepo } from '../trading/stock-master-repo';
import { StockMasterSyncService } from '../trading/stock-master-sync';
import { StrategyRepo } from '../trading/strategy-repo';
import { TradingCalendarService } from '../trading/trading-calendar-service';
import { createContextFactory } from '../trpc/context';

function resolveMigrationsDir(): string {
  // dev: projectRoot/drizzle
  // packaged: extraResources 설정에 따라 process.resourcesPath/drizzle
  if (isDev) return join(process.cwd(), 'drizzle');
  return join(process.resourcesPath, 'drizzle');
}

export function bootstrapDeps(userDataDir: string) {
  markStartup('bootstrap.start');
  const bootStatus = new BootStatusService();
  markStartup('db.open.start');
  const db = openDb(defaultDbPath(userDataDir));
  markStartup('db.open.end');
  markStartup('db.migrate.start');
  migrate(db, resolveMigrationsDir());
  markStartup('db.migrate.end');
  markStartup('db.runtime-repair.start');
  repairAccountsRuntimeSchema(db);
  repairMarketContextRuntimeSchema(db);
  repairTradingCalendarRuntimeSchema(db);
  markStartup('db.runtime-repair.end');

  markStartup('bootstrap.repos.start');
  const credentialsRepo = new CredentialsRepo(db, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  });
  const tokenStore = new TokenStore(db);
  const dbLogger = createEventLogger(db, {
    onInserted: (entry) => broadcastToAllWindows('appShell:event-log-appended', entry),
  });
  if (!isDev) app.setAppLogsPath();
  const logsRoot = isDev ? join(process.cwd(), 'logs', 'dev') : app.getPath('logs');
  const fileLogger = createFileLogger({ dir: logsRoot, retentionDays: 40 });
  const errorFileLogger = createFileLogger({
    dir: join(logsRoot, 'errors'),
    retentionDays: 40,
  });
  const apiErrorFileLogger = createFileLogger({
    dir: join(logsRoot, 'api-errors'),
    retentionDays: 40,
  });
  const eventLogger = teeLoggers(dbLogger, splitErrorLogger(fileLogger, errorFileLogger));
  configureStartupPerf({ logger: eventLogger });
  markStartup('bootstrap.logger.ready');
  setTimeout(() => {
    markStartup('logs.maintenance.start');
    fileLogger.rotate();
    errorFileLogger.rotate();
    apiErrorFileLogger.rotate();
    const removedLogs = cleanupOldEventLogs(db, 30);
    if (removedLogs > 0) {
      console.info(`[event-logger] cleaned up ${removedLogs} rows older than 30 days`);
    }
    markStartup('logs.maintenance.end', { removedLogs });
  }, 0);
  const apiFailureLogger = createApiFailureLogger(eventLogger, apiErrorFileLogger);
  bootStatus.markRuntimeStarting('main dependencies are being initialized');
  // KIS 공식 RPS 한도: 실전 20 req/s, 모의 5 req/s. 20% margin 확보해 실전 18/모의 4로 운영.
  // 모의에서 15 RPS 디폴트 유지 시 watchEngine/quote-feed 와 balance polling 동시 발생 시
  // KIS 가 유량초과로 5xx 반환 → "잔고 서버에 일시적인 문제" 메시지로 변환되던 원인.
  // logger 주입 — logs 페이지에서 `kis.http.*` message 로 요청/응답 감사 가능.
  const httpByEnv = {
    MOCK: new KisHttpClient({
      baseUrl: KIS_BASE_URL.MOCK,
      rateLimitRps: 4,
      logger: eventLogger,
      envLabel: 'MOCK',
    }),
    PROD: new KisHttpClient({
      baseUrl: KIS_BASE_URL.PROD,
      rateLimitRps: 18,
      logger: eventLogger,
      envLabel: 'PROD',
    }),
  };
  const auth = new AuthService(httpByEnv, tokenStore);

  // Kiwoom REST 클라이언트 (PROD/MOCK 각각, 보수적 8rps). 사용자가 Kiwoom 자격증명을
  // 등록하지 않으면 실제 호출 없음 — 인스턴스만 미리 만들어 ctx 주입.
  const kiwoomHttpByEnv = {
    MOCK: new KiwoomHttpClient({ baseUrl: KIWOOM_BASE_URL.MOCK, rateLimitRps: 8 }),
    PROD: new KiwoomHttpClient({ baseUrl: KIWOOM_BASE_URL.PROD, rateLimitRps: 8 }),
  };
  const kiwoomTokenStore = new KiwoomTokenStore(db);
  // Kiwoom WS factory — 실제 WebSocket 연결. 라이브 검증 시 socket-client 가 사용.
  const kiwoomWsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;
  // per-account SafetyState 격리 registry. 각 계좌는 자체 master/symbol/errorLock 슬롯.
  const settingsRepo = new SettingsRepo(db);
  // 안전 스위치 master 영속화 hooks 주입 — 부팅 시 settings 에서 복원, setMaster 시 자동 저장.
  // 사용자가 ON 으로 설정한 뒤 앱을 닫고 다시 켰을 때 항상 차단으로 돌아가던 회귀 차단.
  const safetyRegistry = new SafetyStateRegistry({
    logger: eventLogger,
    readMaster: (accountId) => readSafetyMaster(settingsRepo, accountId),
    writeMaster: (accountId, on) => writeSafetyMaster(settingsRepo, accountId, on),
  });
  const strategyRepo = new StrategyRepo(settingsRepo, eventLogger);
  const stockMasterRepo = new StockMasterRepo(db);
  const stockMasterSync = new StockMasterSyncService(stockMasterRepo, settingsRepo);
  const candlesRepo = new DailyCandlesRepo(db);
  const tradingCalendar = new TradingCalendarService({ db, logger: eventLogger });
  markStartup('trading-calendar.seed.start');
  try {
    tradingCalendar.seedBundled();
  } catch (cause) {
    eventLogger.log({
      level: 'ERROR',
      category: 'SYS',
      message: 'trading-calendar.seed-failed',
      payload: { cause: cause instanceof Error ? cause.message : String(cause) },
    });
  }
  markStartup('trading-calendar.seed.end');
  const prebuyRepo = new PrebuyRepo(db);
  // stockMasterRepo 주입 — cyclesByPdno 의 종목명(name) 필드를 stock_master 에서 lookup.
  const lotsRepo = new LotsRepo(db, stockMasterRepo);
  const activeAccounts = new ActiveAccountRepo(db);
  const timeWindowRepo = createTimeWindowRepo(db);
  const rateGuardRepo = createRateGuardRepo(db);
  const protectionLimitsRepo = new ProtectionLimitsRepo(db);
  // AI provider 키 저장소 + LLM 호출 추상 클라이언트 — Phase 1+ 종목 추천 / Phase 2 strategy 추천에 사용.
  // 키 미등록 시에도 정상 부팅 (라우터에서 null 가드).
  const aiCredentialsRepo = new AiCredentialsRepo({
    db,
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (encrypted) => safeStorage.decryptString(encrypted),
    },
    logger: eventLogger,
  });
  const llmClient = new LlmClient({ logger: eventLogger });
  // DART REST 클라이언트 — 빌드 임베드 키 사용 (사용자 BYO X). 키 누락 시 isAvailable=false → 호출자에서 graceful skip.
  const dartClient = new DartClient({
    logger: apiFailureLogger,
    apiKey: process.env.DART_API_KEY ?? '',
  });
  const dartCorpCodeRepo = new DartCorpCodeRepo({
    db,
    logger: apiFailureLogger,
    apiKey: process.env.DART_API_KEY ?? '',
  });
  const newsFetcher = new NewsFetcher({
    logger: apiFailureLogger,
    naverClientId: process.env.NAVER_CLIENT_ID ?? '',
    naverClientSecret: process.env.NAVER_CLIENT_SECRET ?? '',
  });
  const naverDatalabClient = new NaverDatalabClient({
    logger: apiFailureLogger,
    naverClientId: process.env.NAVER_CLIENT_ID ?? '',
    naverClientSecret: process.env.NAVER_CLIENT_SECRET ?? '',
  });
  const krxClient = new KrxClient({
    logger: apiFailureLogger,
    apiKey: process.env.KRX_API_KEY ?? '',
  });
  const ecosClient = new EcosClient({
    logger: apiFailureLogger,
    apiKey: process.env.ECOS_API_KEY ?? '',
  });
  const marketContextRepo = new MarketContextRepo(db);
  const marketContextService = new MarketContextService({
    krxClient,
    ecosClient,
    repo: marketContextRepo,
    settingsRepo,
    stockMasterRepo,
    logger: apiFailureLogger,
  });
  const protectionGuard = new ProtectionGuard(db, protectionLimitsRepo);
  markStartup('bootstrap.repos.end');
  // 활성 계좌 보장 — 계좌 0개면 null. 자격증명 저장 시 자동 시드.
  const ensured = activeAccounts.ensureActive();
  const initialActiveAccountId = ensured.isOk() ? ensured.value : null;
  if (ensured.isOk()) {
    // 단일 계좌 시절 strategy 키를 활성 계좌로 이전 (멱등).
    strategyRepo.migrateLegacyKeys(ensured.value);
  }
  const strategyMigration = strategyRepo.upgradeStoredProfiles();
  markStartup('strategy.migration.end', { recovered: strategyMigration.recovered });
  const backfillStrategiesForAccount = (accountId: number): void => {
    const rows = lotsRepo.listRows(accountId);
    if (rows.isErr()) {
      eventLogger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'strategy.backfill.account-scan-failed',
        payload: { accountId, reason: rows.error.kind },
      });
      return;
    }
    const openPdnos = rows.value.filter((row) => row.status === 'OPEN').map((row) => row.pdno);
    strategyRepo.backfillMissingActiveProfiles(accountId, openPdnos);
  };
  for (const account of activeAccounts.list()) {
    backfillStrategiesForAccount(account.id);
  }
  markStartup('strategy.backfill.end');
  if (strategyMigration.recovered > 0) {
    void app.whenReady().then(async () => {
      await dialog.showMessageBox({
        type: 'warning',
        title: '자동매매 설정 복구',
        message:
          '일부 자동매매 설정을 새 형식으로 읽을 수 없어 기본 자동매매 설정으로 복구했습니다.',
        detail: `복구된 항목: ${strategyMigration.recovered}건`,
      });
    });
  }
  const watchEvents = createWatchEventDispatchers({
    settingsRepo,
    logger: eventLogger,
    broadcastToAllWindows,
    notifyWatchOutcome,
    notifyTrade,
  });
  const factoryRef: { factory: ReturnType<typeof createContextFactory> | null } = { factory: null };
  markStartup('trading-runtime.create.start');
  const tradingRuntime = createTradingRuntime({
    db,
    settingsRepo,
    credentialsRepo,
    auth,
    httpByEnv,
    safetyRegistry,
    logger: eventLogger,
    lotsRepo,
    strategyRepo,
    prebuyRepo,
    activeAccounts,
    timeWindowRepo,
    rateGuardRepo,
    protectionGuard,
    factoryRef,
    watchEvents,
    broadcastToAllWindows,
  });
  const { bus, watchEngine, strategyEngine, pendingOrderWatcher, prebuyWatchers } = tradingRuntime;
  markStartup('trading-runtime.create.end');

  markStartup('context-factory.create.start');
  const factory = createContextFactory({
    bootStatus,
    db,
    credentialsRepo,
    settingsRepo,
    auth,
    httpByEnv,
    kiwoomHttpByEnv,
    kiwoomTokenStore,
    kiwoomWsFactory,
    safetyRegistry,
    logger: eventLogger,
    strategyRepo,
    stockMasterRepo,
    stockMasterSync,
    candlesRepo,
    tradingCalendar,
    lotsRepo,
    prebuyRepo,
    activeAccounts,
    timeWindowRepo,
    rateGuardRepo,
    protectionLimitsRepo,
    watchEngine,
    strategyEngine,
    pendingOrderWatcher,
    bus,
    aiCredentialsRepo,
    llmClient,
    dartClient,
    dartCorpCodeRepo,
    marketContextService,
    naverDatalabClient,
    newsFetcher,
    initialActiveAccountId,
    realtimeFactory: tradingRuntime.realtimeFactory,
  });
  factoryRef.factory = factory;
  markStartup('context-factory.create.end');

  eventLogger.log({
    level: 'INFO',
    category: 'WS',
    message: 'rotating-quote-feed.wired',
    payload: { symbols: tradingRuntime.quoteFeed.getActiveSymbols().length },
  });

  // 저장된 자격증명이 있으면 마지막 활성 환경 복원 — 재시작 후 자동 로그인.
  const savedEnv = settingsRepo.get(SETTING_KEYS.LAST_ACTIVE_ENV);
  if (savedEnv === 'MOCK' || savedEnv === 'PROD') {
    const cred = credentialsRepo.loadCredentialsByEnv(savedEnv as AppEnv);
    if (cred.isOk() && cred.value) {
      factory.setEnv(savedEnv as AppEnv);
      // 해당 env 의 계좌를 활성으로 전환.
      const accId = credentialsRepo.resolveAccountIdByEnv(savedEnv as AppEnv);
      if (accId !== null) {
        repairAccountFromStoredCredentials(
          { activeAccounts, credentialsRepo, logger: eventLogger },
          accId,
        );
        activeAccounts.setActiveAccountId(accId);
        factory.setActiveAccountId(accId);
      }
      eventLogger.log({
        level: 'INFO',
        category: 'AUTH',
        message: 'auth.env.restored',
        payload: { env: savedEnv, accountId: accId },
      });
      // 로그인 상태에서 24시간 초과 시 백그라운드로 종목 마스터 동기화.
      // 네트워크 실패는 로그만 남기고 부팅 지연 없이 계속 진행.
      stockMasterSync.syncIfStaleWithLog(eventLogger);
    }
  }

  const accountSyncRuntime = createAccountSyncRuntime({
    db,
    factory,
    factoryRef,
    lotsRepo,
    logger: eventLogger,
    strategyEngine,
    backfillStrategiesForAccount,
    broadcastTradeExecution: watchEvents.broadcastTradeExecution,
  });
  const { balanceSync, currentStateSync, manualOrderReconciler } = accountSyncRuntime;
  markStartup('account-sync-runtime.create.end');
  bootStatus.markRuntimeReady('runtime initialized');
  bootStatus.setFlags({ backupReady: false });
  markStartup('bootstrap.end');

  return {
    factory,
    bootStatus,
    currentStateSync,
    safetyRegistry,
    eventLogger,
    settingsRepo,
    prebuyWatchers,
    balanceSync,
    manualOrderReconciler,
    dbPath: defaultDbPath(userDataDir),
  };
}

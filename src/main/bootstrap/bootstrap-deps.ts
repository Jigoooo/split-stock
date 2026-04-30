import { join } from 'node:path';
import type {
  AppEnv,
  AutoOrderRetryEvent,
  TradeExecutionEvent,
  WatchOutcomeEvent,
} from '@shared/contracts';
import { AutoOrderRetryEventSchema } from '@shared/contracts';
import { isRegularMarketOpenKst } from '@shared/trading/market-session';
import { and, eq } from 'drizzle-orm';
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
import { KiwoomHttpClient } from '../brokers/kiwoom/http-client';
import { KIWOOM_BASE_URL } from '../brokers/kiwoom/metadata/endpoints';
import { KiwoomTokenStore } from '../brokers/kiwoom/token-store';
import { defaultDbPath, migrate, openDb } from '../db/client';
import {
  repairAccountsRuntimeSchema,
  repairMarketContextRuntimeSchema,
  repairTradingCalendarRuntimeSchema,
} from '../db/runtime-schema-repair';
import { orders } from '../db/schema';
import {
  readPendingCancelConfig,
  readRealtimeConfig,
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
import { cancelOrRevise } from '../kis/order';
import { TokenStore } from '../kis/token-store';
import { realTimer, type WsFactory, type WsLike } from '../kis/ws-client';
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
import { FeedBus } from '../realtime/feed-bus';
import { RealtimeService } from '../realtime/realtime-service';
import { ProtectionGuard } from '../safety/protection-guard';
import { ProtectionLimitsRepo } from '../safety/protection-limits-repo';
import { createRateGuardRepo } from '../safety/rate-guard';
import { SafetyStateRegistry } from '../safety/safety-state';
import { createTimeWindowRepo } from '../safety/time-window';
import { CredentialsRepo } from '../security/credentials-repo';
import { AutoBuyGuard } from '../trading/auto-buy-guard';
import { isAutoOrderBlockedError } from '../trading/auto-order-errors';
import { BalanceSync } from '../trading/balance-sync';
import { CurrentStateSync } from '../trading/current-state-sync';
import { DailyCandlesRepo } from '../trading/daily-candles-repo';
import { createEnvAwarePricePoller } from '../trading/env-aware-price-poller';
import { createInFlightCoordinator } from '../trading/in-flight-coordinator';
import { LotsRepo } from '../trading/lots-repo';
import { ManualOrderReconciler } from '../trading/manual-order-reconciler';
import { MarketSessionGuard } from '../trading/market-session-guard';
import { PendingOrderWatcher } from '../trading/pending-order-watcher';
import { PrebuyRepo } from '../trading/prebuy-repo';
import { PrebuyWatcher } from '../trading/prebuy-watcher';
import { StockMasterRepo } from '../trading/stock-master-repo';
import { StockMasterSyncService } from '../trading/stock-master-sync';
import { StrategyExecutionEngine } from '../trading/strategy-execution-engine';
import { StrategyRepo } from '../trading/strategy-repo';
import { RotatingQuoteFeed } from '../trading/tiered-quote-feed';
import { TradingCalendarService } from '../trading/trading-calendar-service';
import { WatchEngine, type WatchOrder } from '../trading/watch-engine';
import { quarantineLegacyWatchRows } from '../trading/watch-legacy-quarantine';
import { executeStrategyOrder, executeWatchOrder } from '../trading/watch-order-executor';
import { createContextFactory } from '../trpc/context';

function resolveMigrationsDir(): string {
  // dev: projectRoot/drizzle
  // packaged: extraResources 설정에 따라 process.resourcesPath/drizzle
  if (isDev) return join(process.cwd(), 'drizzle');
  return join(process.resourcesPath, 'drizzle');
}

export function bootstrapDeps(userDataDir: string) {
  const db = openDb(defaultDbPath(userDataDir));
  migrate(db, resolveMigrationsDir());
  repairAccountsRuntimeSchema(db);
  repairMarketContextRuntimeSchema(db);
  repairTradingCalendarRuntimeSchema(db);

  const credentialsRepo = new CredentialsRepo(db, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  });
  const tokenStore = new TokenStore(db);
  const dbLogger = createEventLogger(db);
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
  // 부팅 시 1회 로테이션 — 40일 경과 파일 정리
  fileLogger.rotate();
  errorFileLogger.rotate();
  apiErrorFileLogger.rotate();
  // event_logs 테이블 retention — 30일 초과 row 삭제. 장기 운영 시 디스크/DB 비대 방지.
  // 콘솔에 정리 결과를 한 줄 노출 (event_logger 자체에는 기록 안 함 — 자기참조 회피).
  const removedLogs = cleanupOldEventLogs(db, 30);
  if (removedLogs > 0) {
    console.info(`[event-logger] cleaned up ${removedLogs} rows older than 30 days`);
  }
  const eventLogger = teeLoggers(dbLogger, splitErrorLogger(fileLogger, errorFileLogger));
  const apiFailureLogger = createApiFailureLogger(eventLogger, apiErrorFileLogger);
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
  // 활성 계좌 보장 — 계좌 0개면 null. 자격증명 저장 시 자동 시드.
  const ensured = activeAccounts.ensureActive();
  const initialActiveAccountId = ensured.isOk() ? ensured.value : null;
  if (ensured.isOk()) {
    // 단일 계좌 시절 strategy 키를 활성 계좌로 이전 (멱등).
    strategyRepo.migrateLegacyKeys(ensured.value);
  }
  const strategyMigration = strategyRepo.upgradeStoredProfiles();
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
  const toWatchOutcomeEvent = (
    status: WatchOutcomeEvent['status'],
    order: WatchOrder,
    extras: {
      triggerPrice?: number | null;
      failureReason?: string | null;
    } = {},
  ): WatchOutcomeEvent => ({
    watchId: order.id,
    accountId: order.accountId,
    pdno: order.pdno,
    source: order.source,
    side: order.side,
    status,
    targetPrice: order.targetPrice,
    triggerPrice: extras.triggerPrice ?? null,
    orderType: order.orderType,
    failureReason: extras.failureReason ?? null,
    occurredAt: Date.now(),
  });
  const broadcastWatchOutcome = (event: WatchOutcomeEvent): void => {
    if (settingsRepo.get('notifications.osEnabled') !== 'false') {
      notifyWatchOutcome(event);
    }
    broadcastToAllWindows('appShell:watch-event', event);
  };
  const broadcastAutoOrderRetry = (event: AutoOrderRetryEvent): void => {
    const parsed = AutoOrderRetryEventSchema.safeParse(event);
    if (!parsed.success) {
      eventLogger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'auto-order-retry.invalid-event',
        payload: { reason: parsed.error.message },
      });
      return;
    }
    broadcastToAllWindows('appShell:auto-order-retry', parsed.data);
  };
  const broadcastTradeExecution = (event: TradeExecutionEvent): void => {
    if (settingsRepo.get('notifications.osEnabled') !== 'false') {
      notifyTrade({
        pdno: event.pdno,
        side: event.side === 'BUY' ? 'buy' : 'sell',
        qty: event.filledQty,
        price: event.price,
        name: event.name,
      });
    }
    broadcastToAllWindows('appShell:trade-event', event);
  };
  quarantineLegacyWatchRows(db, eventLogger);
  const sharedPriceFeedRef: { feed: RotatingQuoteFeed | null } = { feed: null };
  const priceFeedRefCounts = new Map<string, number>();
  const watchTrackedPdnosRef = new Set<string>();
  const strategyTrackedPdnosRef = new Set<string>();
  const currentStateSyncRef: { sync: CurrentStateSync | null } = { sync: null };
  // factory 참조를 closure 로 빼는 래퍼 — RealtimeService/price poller 초기화 시점이 factory 생성 전이라 필요.
  const factoryRef: { factory: ReturnType<typeof createContextFactory> | null } = { factory: null };
  const acquireSharedPriceFeed = (pdno: string): void => {
    const nextCount = (priceFeedRefCounts.get(pdno) ?? 0) + 1;
    priceFeedRefCounts.set(pdno, nextCount);
    if (nextCount === 1) {
      sharedPriceFeedRef.feed?.subscribe(pdno);
    }
  };
  const releaseSharedPriceFeed = (pdno: string): void => {
    const prevCount = priceFeedRefCounts.get(pdno) ?? 0;
    if (prevCount <= 1) {
      priceFeedRefCounts.delete(pdno);
      sharedPriceFeedRef.feed?.unsubscribe(pdno);
      return;
    }
    priceFeedRefCounts.set(pdno, prevCount - 1);
  };
  const syncTrackedPdnos = (tracked: Set<string>, pdnos: string[]): void => {
    const next = new Set(pdnos);
    for (const pdno of Array.from(tracked)) {
      if (next.has(pdno)) continue;
      tracked.delete(pdno);
      releaseSharedPriceFeed(pdno);
    }
    for (const pdno of next) {
      if (tracked.has(pdno)) continue;
      tracked.add(pdno);
      acquireSharedPriceFeed(pdno);
    }
  };
  const syncWatchPriceFeed = (pdnos: string[]): void => {
    syncTrackedPdnos(watchTrackedPdnosRef, pdnos);
  };
  const syncStrategyPriceFeed = (pdnos: string[]): void => {
    syncTrackedPdnos(strategyTrackedPdnosRef, pdnos);
  };
  // 자동감시·자동매매 cross-source dedupe 토큰. 같은 (accountId, pdno) 종목에 대해
  // WatchEngine 과 StrategyExecutionEngine 가 동일 tick 으로 동시에 fire 하지 못하도록.
  const inFlightCoordinator = createInFlightCoordinator();

  // 통합 자동감시주문 엔진 — 예약매수/사용자 감시를 단일 큐로 관리.
  // 계좌별 어댑터는 registerHandler로 핸들러를 주입한다.
  const watchEngine = new WatchEngine({
    db,
    timer: realTimer,
    inFlightCoordinator,
    onWatchingPdnosChanged: syncWatchPriceFeed,
    onExecuted: (order) => {
      eventLogger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'watch.executed',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
        },
      });
      broadcastWatchOutcome(toWatchOutcomeEvent('EXECUTED', order));
    },
    onFailed: (order, reason) => {
      eventLogger.log({
        level: 'WARN',
        category: 'WATCH',
        message: 'watch.failed',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
          reason,
        },
      });
      broadcastWatchOutcome(toWatchOutcomeEvent('FAILED', order, { failureReason: reason }));
    },
    onExpired: (order) => {
      eventLogger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'watch.expired',
        payload: {
          accountId: order.accountId,
          watchId: order.id,
          source: order.source,
          pdno: order.pdno,
        },
      });
      broadcastWatchOutcome(toWatchOutcomeEvent('EXPIRED', order));
    },
  });
  watchEngine.startCycle();
  // 실시간 버스는 env 전환 상관없이 공유, RealtimeService는 env별 lazy 재생성.
  const bus = new FeedBus();
  const wsFactory = (url: string): WsLike => new WebSocket(url) as unknown as WsLike;

  /**
   * REST 회전 폴링 큐. WS 한도(20·향후 60) 초과 종목을 자동 위임받아 가격을
   * watchEngine.onPrice 로 흘려 보낸다. PREBUY/CUSTOM watch_orders 트리거 평가도
   * 동일 경로로 가동됨.
   *
   * 활성 env 가 바뀌어도 본 인스턴스는 동일 — env-aware poller 가 매 fetch 마다 currentEnv 를
   * lazy 로 끌어와 최신 자격증명/토큰 사용. env 미선택/자격증명 부재 시 NETWORK 에러 → 쿨다운.
   */
  const tieredFeed = new RotatingQuoteFeed({
    timer: realTimer,
    poller: createEnvAwarePricePoller({
      getBroker: () => factoryRef.factory?.getBroker() ?? null,
    }),
    logger: eventLogger,
    getRatePerSec: () => {
      const env = factoryRef.factory?.getCurrentEnv() ?? null;
      if (env === 'MOCK') return isRegularMarketOpenKst() ? 4 : 2;
      return isRegularMarketOpenKst() ? 18 : 6;
    },
  });
  tieredFeed.on('quote', ({ pdno, price }) => {
    bus.emitTick({
      pdno,
      time: '',
      price,
      dayChange: 0,
      dayChangeRate: 0,
      tickDirection: 'FLAT',
      volume: 0,
      accumVolume: 0,
      open: 0,
      high: 0,
      low: 0,
      bestAsk: 0,
      bestBid: 0,
    });
    watchEngine.onPrice(pdno, price);
  });
  // C3: 시세 폴링이 5회 연속 실패해 cooldown 진입한 종목을 사용자에게 알림.
  // 자동감시 중인 종목인데 시세가 안 들어오면 trigger 가 영원히 안 일어나는 상황을
  // 사용자가 알아야 한다.
  tieredFeed.on('cooldown', ({ pdno, failures, error }) => {
    const reason = error.kind ?? 'unknown';
    eventLogger.log({
      level: 'WARN',
      category: 'WATCH',
      message: 'quote-feed.cooldown',
      payload: { pdno, failures, reason },
    });
    broadcastToAllWindows('appShell:quote-feed-cooldown', { pdno, failures, reason });
  });
  sharedPriceFeedRef.feed = tieredFeed;
  for (const [pdno, count] of priceFeedRefCounts) {
    if (count > 0) {
      tieredFeed.subscribe(pdno);
    }
  }

  // RealtimeService 가 capacity 초과 종목을 RotatingQuoteFeed 에 위임하도록 어댑터 wiring.
  const restFallbackAdapter = {
    subscribe: (pdno: string) => acquireSharedPriceFeed(pdno),
    unsubscribe: (pdno: string) => releaseSharedPriceFeed(pdno),
  };

  let lastRealtime: RealtimeService | null = null;

  // NM-001: 미체결 자동취소 — 타임아웃 시 KIS cancel 호출.
  // onExpire 이후 성공 시 cancel(entry) 로 감시 해제, 실패 시 rearm() 으로 다음 사이클 대기.
  // reorderMode='NONE' 고정 — 1.0 범위에서 재주문 미지원(사용자가 시세 보고 직접 재주문).
  // pending-order-watcher 자체는 MARKET/LIMIT_AT_LAST_PRICE 도 지원하므로 향후 다시 활성화 가능.
  const pendingCancelCfg = readPendingCancelConfig(settingsRepo);
  const pendingOrderWatcher: PendingOrderWatcher = new PendingOrderWatcher({
    timer: realTimer,
    timeoutMs: pendingCancelCfg.timeoutMs,
    maxRetries: pendingCancelCfg.maxRetries,
    reorderMode: 'NONE',
    // A4: 토큰/네트워크 일시 실패 시 같은 간격으로 KIS hammering 하지 않도록 지수 백오프.
    // 첫 만료는 timeoutMs 그대로, rearm 1회 → ×3, rearm 2회 → ×9, 그 이후도 ×9 cap.
    backoffMultiplier: 3,
    backoffMaxFactor: 9,
    onExpire: async (entry, attempt) => {
      // 토글 OFF 후 메모리에 남아있던 watcher entry 가 만료되어도 KIS cancel 호출하지 않도록
      // 매 호출마다 현재 enabled 를 재확인. 사용자가 OFF 한 시점부터는 자동취소가 일어나면 안 됨.
      const currentCfg = readPendingCancelConfig(settingsRepo);
      if (!currentCfg.enabled) {
        eventLogger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'feature_disabled', odno: entry.odno, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const env = factoryRef.factory?.getCurrentEnv() ?? null;
      const accountId = entry.accountId ?? factoryRef.factory?.getActiveAccountId() ?? null;
      if (!env || !accountId) {
        eventLogger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'env_or_account_missing', odno: entry.odno, attempt },
        });
        return;
      }
      if (!entry.orgNo) {
        eventLogger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'orgNo_missing', odno: entry.odno, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
        return;
      }
      const credResult = credentialsRepo.loadCredentials(accountId);
      if (credResult.isErr() || !credResult.value) {
        eventLogger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.skip',
          payload: { reason: 'credentials_missing', odno: entry.odno, accountId, attempt },
        });
        return;
      }
      const cred = credResult.value;
      const tokenResult = await auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        eventLogger.log({
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
          http: httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
          logger: eventLogger,
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
        db.update(orders)
          .set({ status: 'CANCELLED' })
          .where(and(eq(orders.odno, entry.odno), eq(orders.accountId, accountId)))
          .run();
        eventLogger.log({
          level: 'INFO',
          category: 'ORDER',
          message: 'pending-cancel.success',
          payload: { odno: entry.odno, pdno: entry.pdno, side: entry.side, attempt },
        });
        pendingOrderWatcher.cancel({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      } else {
        eventLogger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'pending-cancel.failed',
          payload: { odno: entry.odno, kind: r.error.kind, msg: r.error.msg, attempt },
        });
        pendingOrderWatcher.rearm({ pdno: entry.pdno, side: entry.side, nth: entry.nth });
      }
    },
    onLimitReached: (entry) => {
      eventLogger.log({
        level: 'ERROR',
        category: 'ORDER',
        message: 'pending-cancel.limit-reached',
        payload: { odno: entry.odno, pdno: entry.pdno, side: entry.side, nth: entry.nth },
      });
    },
  });
  const marketSessionGuard = new MarketSessionGuard({
    getBroker: () => factoryRef.factory?.getBroker() ?? null,
    logger: eventLogger,
  });
  const autoBuyGuard = new AutoBuyGuard({
    logger: eventLogger,
    protectionGuard,
    rateGuardRepo,
    strategyRepo,
    timeWindowRepo,
  });

  const runWatchedOrder = async (order: WatchOrder, triggerPrice: number): Promise<void> => {
    await executeWatchOrder(
      {
        db,
        settingsRepo,
        getBrokerForAccount: (accountId) => {
          const ctx = factoryRef.factory;
          if (!ctx || ctx.getActiveAccountId() !== accountId) return null;
          return ctx.getBroker();
        },
        safetyRegistry,
        pendingOrderWatcher,
        logger: eventLogger,
        lotsRepo,
        strategyRepo,
        marketSessionGuard,
        autoBuyGuard,
      },
      order,
      triggerPrice,
    );
  };
  const isKeepWatchingError = (error: unknown): boolean =>
    isAutoOrderBlockedError(error) ||
    (error instanceof Error &&
      /이미 활성 차수가 있어 신규 1차 자동진입을 생략/.test(error.message));

  watchEngine.setFallbackHandler('CUSTOM', async (order, ctx) => {
    try {
      await runWatchedOrder(order, ctx.price);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        ...(isKeepWatchingError(error) ? { keepWatching: true } : {}),
      };
    }
  });
  watchEngine.setFallbackHandler('PREBUY', async (order, ctx) => {
    const prebuyId = Number(order.sourceRefId);
    if (!Number.isInteger(prebuyId) || prebuyId <= 0) {
      return { ok: false, reason: 'PREBUY_SOURCE_REF_INVALID' };
    }
    const source = prebuyRepo.getById(prebuyId);
    if (!source) return { ok: false, reason: 'PREBUY_SOURCE_NOT_FOUND' };
    if (source.accountId !== null && source.accountId !== order.accountId) {
      return { ok: false, reason: 'PREBUY_ACCOUNT_MISMATCH' };
    }
    if (source.status !== 'PENDING') {
      return { ok: false, reason: `PREBUY_STATUS_${source.status}` };
    }
    try {
      await runWatchedOrder(order, ctx.price);
      prebuyRepo.markFilled(source.id);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        ...(isKeepWatchingError(error) ? { keepWatching: true } : {}),
      };
    }
  });
  const strategyEngine = new StrategyExecutionEngine({
    bus,
    logger: eventLogger,
    lotsRepo,
    strategyRepo,
    safetyRegistry,
    inFlightCoordinator,
    getActiveAccountId: () => factoryRef.factory?.getActiveAccountId() ?? null,
    onTrackedPdnosChanged: syncStrategyPriceFeed,
    onAutoOrderRetryScheduled: broadcastAutoOrderRetry,
    marketSessionGuard,
    executeOrder: async (input) => {
      return executeStrategyOrder(
        {
          db,
          settingsRepo,
          getBrokerForAccount: (accountId) => {
            const ctx = factoryRef.factory;
            if (!ctx || ctx.getActiveAccountId() !== accountId) return null;
            return ctx.getBroker();
          },
          safetyRegistry,
          pendingOrderWatcher,
          logger: eventLogger,
          lotsRepo,
          strategyRepo,
          autoBuyGuard,
        },
        {
          accountId: input.accountId,
          pdno: input.pdno,
          side: input.side,
          division: input.division,
          nth: input.nth,
          price: input.price,
          qty: input.qty,
          ...(input.reconcileOnly !== undefined && { reconcileOnly: input.reconcileOnly }),
          triggerReason: input.triggerReason,
        },
      );
    },
  });
  syncWatchPriceFeed(watchEngine.list({ status: 'WATCHING' }).map((order) => order.pdno));
  strategyEngine.refreshTrackedSymbols();

  const prebuyWatchers = new Map<number, PrebuyWatcher>();
  for (const account of activeAccounts.list()) {
    const prebuyWatcher = new PrebuyWatcher({
      timer: realTimer,
      repo: prebuyRepo,
      engine: watchEngine,
      accountId: account.id,
      onTrigger: (source, ctx) => {
        return runWatchedOrder(
          {
            id: 0,
            accountId: account.id,
            pdno: source.pdno,
            source: 'PREBUY',
            side: 'BUY',
            targetPrice: source.targetPrice,
            comparator: 'LTE',
            orderType: 'LIMIT',
            qtyOrAmountMode: 'AMOUNT',
            qty: null,
            amountKrw: source.amountKrw,
            nth: null,
            sourceRefId: String(source.id),
            expiresAt: source.validUntil,
            status: 'WATCHING',
            lastFailureReason: null,
            metadata: null,
            createdAt: source.createdAt,
            updatedAt: source.createdAt,
            executedAt: null,
          },
          ctx.price,
        );
      },
      onExpire: (source) => {
        eventLogger.log({
          level: 'INFO',
          category: 'WATCH',
          message: 'watch.prebuy.expired',
          payload: { accountId: source.accountId, prebuyId: source.id, pdno: source.pdno },
        });
      },
    });
    prebuyWatcher.reload();
    prebuyWatchers.set(account.id, prebuyWatcher);
  }

  const factory = createContextFactory({
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
    realtimeFactory: (env) => {
      if (lastRealtime) {
        lastRealtime.stop();
        lastRealtime = null;
      }
      if (env) {
        const realtimeCfg = readRealtimeConfig(settingsRepo);
        lastRealtime = new RealtimeService({
          env,
          http: httpByEnv[env],
          bus,
          factory: wsFactory,
          logger: eventLogger,
          maxSubscriptions: realtimeCfg.wsCapacity,
          getAccountId: () => factoryRef.factory?.getActiveAccountId() ?? null,
          restFallback: restFallbackAdapter,
        });
      }
      return lastRealtime;
    },
  });
  factoryRef.factory = factory;

  eventLogger.log({
    level: 'INFO',
    category: 'WS',
    message: 'rotating-quote-feed.wired',
    payload: { symbols: tieredFeed.getActiveSymbols().length },
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

  /**
   * 잔고 동기화 — 30초 주기 polling + 체결통보(CNI) 즉시 갱신 진입점.
   * env/credentials를 매 poll마다 lazy하게 읽으므로 env 전환 후에도 재생성 불필요.
   *
   * CNI 체결통보 실시간 트리거(W1-7 Phase B):
   *   AES-256-CBC 복호화 구현 완료 후 KisWsClient.onCniNotice 콜백에서
   *   balanceSync.refresh()를 호출하도록 RealtimeService에 연결 예정.
   */
  const balanceSync = new BalanceSync({
    getBroker: () => factory.getBroker(),
    getAccountId: () => factory.getActiveAccountId(),
    lotsRepo,
    logger: eventLogger,
  });

  // 자격증명이 복원된 상태에서만 시작 (env 복원 블록 이후에도 start는 유효).
  // start() 자체는 no-op이므로 env가 없어도 safe.
  balanceSync.start();
  // 즉시주문 직후 trpc 라우터에서 ctx.balanceSync.refresh() 호출로 즉시 갱신할 수 있도록 주입.
  factory.setBalanceSync(balanceSync);
  const manualOrderReconciler = new ManualOrderReconciler({
    db,
    getBrokerForAccount: (accountId) => {
      const ctx = factoryRef.factory;
      if (!ctx) return null;
      const env = ctx.getCurrentEnv();
      const active = ctx.getActiveAccountId();
      // BrokerPort cache 는 currentEnv + accountId 조합으로 hit. 다른 계좌 행은
      // 활성 env 와 같은 broker 가 호출 가능하므로 active accountId 만 broker 부여.
      if (env === null || active !== accountId) return null;
      return ctx.getBroker();
    },
    logger: eventLogger,
    onTradeExecution: (event) => {
      eventLogger.log({
        level: 'INFO',
        category: 'ORDER',
        message: 'manual-order-reconciler.trade-executed',
        payload: {
          accountId: event.accountId,
          odno: event.odno,
          pdno: event.pdno,
          side: event.side,
          status: event.status,
          filledQty: event.filledQty,
          totalFilledQty: event.totalFilledQty,
          remainingQty: event.remainingQty,
          price: event.price,
        },
      });
      broadcastTradeExecution(event);
      currentStateSyncRef.sync?.trigger('trade-event');
    },
  });
  manualOrderReconciler.start();
  const currentStateSync = new CurrentStateSync({
    balanceSync,
    logger: eventLogger,
    manualOrderReconciler,
    onRefreshed: () => {
      const accountId = factory.getActiveAccountId();
      if (accountId !== null) {
        backfillStrategiesForAccount(accountId);
      }
      strategyEngine.refreshTrackedSymbols();
    },
  });
  currentStateSyncRef.sync = currentStateSync;
  factory.setCurrentStateSync(currentStateSync);
  currentStateSync.trigger('startup');

  return {
    factory,
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

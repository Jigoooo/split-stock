import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
  BrowserWindow as BrowserWindowType,
  IpcMain as IpcMainType,
  safeStorage as safeStorageType,
  session as sessionType,
} from 'electron';
import { createIPCHandler } from 'trpc-electron/main';

// Electron은 CJS-only 모듈. Vite 8(rolldown) + CJS output 조합에서
// `import { app } from 'electron'`이 런타임에 undefined가 되는 interop
// 문제가 있어, createRequire로 직접 require한다.
const electronRequire = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, screen, session, shell } =
  electronRequire('electron') as {
    app: typeof import('electron').app;
    BrowserWindow: typeof BrowserWindowType;
    ipcMain: IpcMainType;
    nativeTheme: typeof import('electron').nativeTheme;
    safeStorage: typeof safeStorageType;
    screen: typeof import('electron').screen;
    session: typeof sessionType;
    shell: typeof import('electron').shell;
  };

// 앱 전반을 라이트 테마로 고정 — 시스템 다크모드 무시.
// macOS 타이틀바, 네이티브 메뉴, 렌더러 color-scheme 모두 light 기반.
nativeTheme.themeSource = 'light';

// dev 전용 'unsafe-eval/inline' 경고 숨김 — 패키징 시 엄격 CSP가 적용되므로 무해.
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

import type { AppEnv, WatchOutcomeEvent } from '@shared/contracts';
import {
  getPopoutRouteConfig,
  getPopoutWindowTitle,
  POPOUT_ROUTES,
  type PopoutRoute,
} from '@shared/popout';
import { and, eq } from 'drizzle-orm';
import WebSocket from 'ws';
import { ActiveAccountRepo } from './account/active-account';
import { BackupScheduler } from './backup/scheduler';
import { defaultDbPath, migrate, openDb } from './db/client';
import { orders } from './db/schema';
import {
  readPendingCancelConfig,
  readRealtimeConfig,
  SETTING_KEYS,
  SettingsRepo,
} from './db/settings-repo';
import { AuthService } from './kis/auth';
import { KIS_BASE_URL } from './kis/endpoints';
import { KisHttpClient } from './kis/http-client';
import { cancelOrRevise } from './kis/order';
import { TokenStore } from './kis/token-store';
import { realTimer, type WsLike } from './kis/ws-client';
import { createEventLogger, teeLoggers } from './logging/event-logger';
import { createFileLogger } from './logging/file-logger';
import { initSentryFromSettings } from './monitoring/sentry';
import { notifyWatchOutcome } from './notification/trade-notifier';
import { FeedBus } from './realtime/feed-bus';
import { RealtimeService } from './realtime/realtime-service';
import { ProtectionLimitsRepo } from './safety/protection-limits-repo';
import { createRateGuardRepo } from './safety/rate-guard';
import { SafetyStateRegistry } from './safety/safety-state';
import { createTimeWindowRepo } from './safety/time-window';
import { CredentialsRepo } from './security/credentials-repo';
import { BalanceSync } from './trading/balance-sync';
import { BoosterWatcher } from './trading/booster-watcher';
import { DailyCandlesRepo } from './trading/daily-candles-repo';
import { createEnvAwarePricePoller } from './trading/env-aware-price-poller';
import { LotsRepo } from './trading/lots-repo';
import { PendingOrderWatcher } from './trading/pending-order-watcher';
import { PrebuyRepo } from './trading/prebuy-repo';
import { PrebuyWatcher } from './trading/prebuy-watcher';
import { StockMasterRepo } from './trading/stock-master-repo';
import { StockMasterSyncService } from './trading/stock-master-sync';
import { StrategyRepo } from './trading/strategy-repo';
import { RotatingQuoteFeed } from './trading/tiered-quote-feed';
import { WatchEngine, type WatchOrder } from './trading/watch-engine';
import { executeWatchOrder } from './trading/watch-order-executor';
import { appRouter } from './trpc/app-router';
import { createContextFactory } from './trpc/context';
import { initAutoUpdater } from './updater';

const isDev = !app.isPackaged;

function resolveMigrationsDir(): string {
  // dev: projectRoot/drizzle
  // packaged: extraResources 설정에 따라 process.resourcesPath/drizzle
  if (isDev) return join(process.cwd(), 'drizzle');
  return join(process.resourcesPath, 'drizzle');
}

function bootstrapDeps(userDataDir: string) {
  const db = openDb(defaultDbPath(userDataDir));
  migrate(db, resolveMigrationsDir());

  const credentialsRepo = new CredentialsRepo(db, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  });
  const tokenStore = new TokenStore(db);
  const dbLogger = createEventLogger(db);
  const logsDir = isDev ? join(process.cwd(), 'logs', 'dev') : join(userDataDir, 'logs');
  const fileLogger = createFileLogger({ dir: logsDir, retentionDays: 40 });
  // 부팅 시 1회 로테이션 — 40일 경과 파일 정리
  fileLogger.rotate();
  const eventLogger = teeLoggers(dbLogger, fileLogger);
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
  // per-account SafetyState 격리 registry. 각 계좌는 자체 master/symbol/errorLock 슬롯.
  const safetyRegistry = new SafetyStateRegistry({ logger: eventLogger });
  const settingsRepo = new SettingsRepo(db);
  const strategyRepo = new StrategyRepo(settingsRepo, eventLogger);
  const stockMasterRepo = new StockMasterRepo(db);
  const stockMasterSync = new StockMasterSyncService(stockMasterRepo, settingsRepo);
  const candlesRepo = new DailyCandlesRepo(db);
  const prebuyRepo = new PrebuyRepo(db);
  // stockMasterRepo 주입 — cyclesByPdno 의 종목명(name) 필드를 stock_master 에서 lookup.
  const lotsRepo = new LotsRepo(db, stockMasterRepo);
  const activeAccounts = new ActiveAccountRepo(db);
  const timeWindowRepo = createTimeWindowRepo(db);
  const rateGuardRepo = createRateGuardRepo(db);
  const protectionLimitsRepo = new ProtectionLimitsRepo(db);
  // 활성 계좌 보장 — 계좌 0개면 null. 자격증명 저장 시 자동 시드.
  const ensured = activeAccounts.ensureActive();
  const initialActiveAccountId = ensured.isOk() ? ensured.value : null;
  if (ensured.isOk()) {
    // 단일 계좌 시절 strategy 키를 활성 계좌로 이전 (멱등).
    strategyRepo.migrateLegacyKeys(ensured.value);
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
    for (const target of BrowserWindow.getAllWindows()) {
      if (target.isDestroyed()) continue;
      target.webContents.send('appShell:watch-event', event);
    }
  };
  // 통합 자동감시주문 엔진 — booster/prebuy/custom을 단일 큐로 관리.
  // BOOSTER/PREBUY 핸들러는 어댑터(BoosterWatcher/PrebuyWatcher) 생성 시 registerHandler로 주입됨.
  const watchEngine = new WatchEngine({
    db,
    timer: realTimer,
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
   * watchEngine.onPrice 로 흘려 보낸다. BOOSTER/PREBUY/CUSTOM watch_orders 트리거 평가도
   * 동일 경로로 가동됨.
   *
   * 활성 env 가 바뀌어도 본 인스턴스는 동일 — env-aware poller 가 매 fetch 마다 currentEnv 를
   * lazy 로 끌어와 최신 자격증명/토큰 사용. env 미선택/자격증명 부재 시 NETWORK 에러 → 쿨다운.
   */
  const tieredFeed = new RotatingQuoteFeed({
    timer: realTimer,
    poller: createEnvAwarePricePoller({
      getEnv: () => factoryRef.factory?.getCurrentEnv() ?? null,
      credentialsRepo,
      auth,
      httpByEnv,
    }),
    logger: eventLogger,
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

  // RealtimeService 가 capacity 초과 종목을 RotatingQuoteFeed 에 위임하도록 어댑터 wiring.
  const restFallbackAdapter = {
    subscribe: (pdno: string) => tieredFeed.subscribe(pdno),
    unsubscribe: (pdno: string) => tieredFeed.unsubscribe(pdno),
  };

  // factory 참조를 closure 로 빼는 래퍼 — RealtimeService 초기화 시점이 factory 생성 전이라 필요.
  const factoryRef: { factory: ReturnType<typeof createContextFactory> | null } = { factory: null };
  let lastRealtime: RealtimeService | null = null;

  // NM-001: 미체결 자동취소 — 타임아웃 시 KIS cancel 호출.
  // onExpire 이후 성공 시 cancel(entry) 로 감시 해제, 실패 시 rearm() 으로 다음 사이클 대기.
  // reorderMode='NONE' 고정 — 재주문은 이번 범위 밖(사용자가 시세 보고 직접 재주문).
  const pendingCancelCfg = readPendingCancelConfig(settingsRepo);
  const pendingOrderWatcher: PendingOrderWatcher = new PendingOrderWatcher({
    timer: realTimer,
    timeoutMs: pendingCancelCfg.timeoutMs,
    maxRetries: pendingCancelCfg.maxRetries,
    reorderMode: 'NONE',
    onExpire: async (entry, attempt) => {
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

  const runWatchedOrder = async (order: WatchOrder, triggerPrice: number): Promise<void> => {
    await executeWatchOrder(
      {
        db,
        settingsRepo,
        credentialsRepo,
        auth,
        httpByEnv,
        safetyRegistry,
        pendingOrderWatcher,
        logger: eventLogger,
        getCurrentEnv: () => factoryRef.factory?.getCurrentEnv() ?? null,
      },
      order,
      triggerPrice,
    );
  };

  watchEngine.setFallbackHandler('CUSTOM', async (order, ctx) => {
    try {
      await runWatchedOrder(order, ctx.price);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
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
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });
  watchEngine.setFallbackHandler('BOOSTER', async (order, ctx) => {
    try {
      await runWatchedOrder(order, ctx.price);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  const prebuyWatchers = new Map<number, PrebuyWatcher>();
  const boosterWatchers = new Map<number, BoosterWatcher>();
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
            nth: 1,
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

    const boosterWatcher = new BoosterWatcher({
      timer: realTimer,
      engine: watchEngine,
      accountId: account.id,
      onTrigger: (task, ctx) => {
        return runWatchedOrder(
          {
            id: 0,
            accountId: account.id,
            pdno: task.pdno,
            source: 'BOOSTER',
            side: 'BUY',
            targetPrice:
              task.boosterPct <= 0
                ? task.lastFilledPrice
                : Math.floor(task.lastFilledPrice * (1 - task.boosterPct)),
            comparator: 'LTE',
            orderType: 'LIMIT',
            qtyOrAmountMode: 'AMOUNT',
            qty: null,
            amountKrw: task.amountKrw,
            nth: 1,
            sourceRefId: task.pdno,
            expiresAt: task.expiresAt !== undefined ? new Date(task.expiresAt) : null,
            status: 'WATCHING',
            lastFailureReason: null,
            metadata: JSON.stringify(task),
            createdAt: new Date(),
            updatedAt: new Date(),
            executedAt: null,
          },
          ctx.price,
        );
      },
      onExpire: (task) => {
        eventLogger.log({
          level: 'INFO',
          category: 'WATCH',
          message: 'watch.booster.expired',
          payload: { accountId: account.id, pdno: task.pdno },
        });
      },
    });
    boosterWatchers.set(account.id, boosterWatcher);
  }

  const factory = createContextFactory({
    db,
    credentialsRepo,
    settingsRepo,
    auth,
    httpByEnv,
    safetyRegistry,
    logger: eventLogger,
    strategyRepo,
    stockMasterRepo,
    stockMasterSync,
    candlesRepo,
    lotsRepo,
    prebuyRepo,
    activeAccounts,
    timeWindowRepo,
    rateGuardRepo,
    protectionLimitsRepo,
    watchEngine,
    pendingOrderWatcher,
    bus,
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
    getEnv: () => factory.getCurrentEnv(),
    getAccountId: () => factory.getActiveAccountId(),
    credentialsRepo,
    auth,
    httpByEnv,
    lotsRepo,
    logger: eventLogger,
  });

  // 자격증명이 복원된 상태에서만 시작 (env 복원 블록 이후에도 start는 유효).
  // start() 자체는 no-op이므로 env가 없어도 safe.
  balanceSync.start();

  return {
    factory,
    safetyRegistry,
    eventLogger,
    settingsRepo,
    prebuyWatchers,
    boosterWatchers,
    balanceSync,
    dbPath: defaultDbPath(userDataDir),
  };
}

interface CreateWindowOpts {
  popoutRoute?: PopoutRoute;
  /** 팝아웃 창은 parent가 위치한 모니터에 열리도록 기준 창을 전달 */
  parent?: BrowserWindowType;
}

interface WindowLayoutSpec {
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  autoContentHeight?: boolean;
}

const MAIN_WINDOW_LAYOUT: WindowLayoutSpec = {
  title: 'Split Stock',
  defaultWidth: 1760,
  defaultHeight: 1100,
  minWidth: 1440,
  minHeight: 900,
};

const windowLayoutByWindow = new WeakMap<BrowserWindowType, WindowLayoutSpec>();

/** 다중 모니터 환경에서 창을 배치할 Display를 고름. */
function pickTargetDisplay(parent?: BrowserWindowType): Electron.Display {
  if (parent && !parent.isDestroyed()) {
    // 팝아웃: 부모 창의 현재 위치와 가장 많이 겹치는 모니터
    return screen.getDisplayMatching(parent.getBounds());
  }
  // 메인: 커서 위치 기준 모니터 (앱을 실행한 곳으로 간주)
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function getWindowLayout(popoutRoute?: PopoutRoute): WindowLayoutSpec {
  if (!popoutRoute) return MAIN_WINDOW_LAYOUT;
  return getPopoutRouteConfig(popoutRoute);
}

function clampWindowSize(value: number, minValue: number | undefined, maxValue: number): number {
  return Math.min(Math.max(value, minValue ?? 0), maxValue);
}

function resolveWindowConstraints(
  layout: WindowLayoutSpec,
  display: Electron.Display,
): {
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
} {
  const area = display.workArea;
  const minWidth =
    layout.minWidth === undefined ? undefined : Math.min(layout.minWidth, area.width);
  const minHeight =
    layout.minHeight === undefined ? undefined : Math.min(layout.minHeight, area.height);
  const maxWidth = area.width;
  const maxHeight = area.height;
  return { minWidth, minHeight, maxWidth, maxHeight };
}

/**
 * 지정 Display의 작업영역을 기준으로 min/max 클램프 + 중앙 배치 좌표 계산.
 */
function resolveWindowBounds(
  layout: WindowLayoutSpec,
  display: Electron.Display,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
} {
  const area = display.workArea;
  const { minWidth, minHeight, maxWidth, maxHeight } = resolveWindowConstraints(layout, display);
  const width = clampWindowSize(layout.defaultWidth, minWidth, maxWidth);
  const height = clampWindowSize(layout.defaultHeight, minHeight, maxHeight);
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  return { x, y, width, height, minWidth, minHeight, maxWidth, maxHeight };
}

function applyDisplayConstraints(win: BrowserWindowType, layout: WindowLayoutSpec): void {
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  const { minWidth, minHeight, maxWidth, maxHeight } = resolveWindowConstraints(layout, display);
  const current = win.getBounds();
  const width = clampWindowSize(current.width, minWidth, maxWidth);
  const height = clampWindowSize(current.height, minHeight, maxHeight);
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  const x = Math.min(Math.max(current.x, area.x), maxX);
  const y = Math.min(Math.max(current.y, area.y), maxY);

  win.setMinimumSize(minWidth ?? 0, minHeight ?? 0);
  win.setMaximumSize(maxWidth, maxHeight);

  if (x !== current.x || y !== current.y || width !== current.width || height !== current.height) {
    win.setBounds({ x, y, width, height });
  }
}

function bindDisplayConstraints(win: BrowserWindowType, layout: WindowLayoutSpec): void {
  let syncing = false;
  const sync = (): void => {
    if (syncing || win.isDestroyed()) return;
    syncing = true;
    try {
      applyDisplayConstraints(win, layout);
    } finally {
      syncing = false;
    }
  };

  const handleDisplayChange = (): void => sync();
  win.on('move', sync);
  win.on('resize', sync);
  screen.on('display-metrics-changed', handleDisplayChange);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  win.once('closed', () => {
    screen.off('display-metrics-changed', handleDisplayChange);
    screen.off('display-added', handleDisplayChange);
    screen.off('display-removed', handleDisplayChange);
  });
}

function fitWindowHeightToContent(
  win: BrowserWindowType,
  layout: WindowLayoutSpec,
  contentHeight: number,
): void {
  const display = screen.getDisplayMatching(win.getBounds());
  const { minHeight, maxHeight } = resolveWindowConstraints(layout, display);
  const bounds = win.getBounds();
  const contentBounds = win.getContentBounds();
  const frameHeight = Math.max(0, bounds.height - contentBounds.height);
  const nextHeight = clampWindowSize(Math.ceil(contentHeight + frameHeight), minHeight, maxHeight);
  if (nextHeight === bounds.height) return;

  const area = display.workArea;
  const nextY = Math.min(Math.max(bounds.y, area.y), area.y + area.height - nextHeight);
  win.setBounds({ x: bounds.x, y: nextY, width: bounds.width, height: nextHeight });
}

function createMainWindow(opts: CreateWindowOpts = {}): BrowserWindowType {
  const { popoutRoute, parent } = opts;
  const display = pickTargetDisplay(parent);
  const layout = getWindowLayout(popoutRoute);
  const bounds = resolveWindowBounds(layout, display);
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(bounds.minWidth !== undefined ? { minWidth: bounds.minWidth } : {}),
    ...(bounds.minHeight !== undefined ? { minHeight: bounds.minHeight } : {}),
    maxWidth: bounds.maxWidth,
    maxHeight: bounds.maxHeight,
    show: false,
    autoHideMenuBar: true,
    title: popoutRoute ? getPopoutWindowTitle(popoutRoute) : layout.title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });
  windowLayoutByWindow.set(win, layout);
  bindDisplayConstraints(win, layout);

  win.on('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const hash = popoutRoute ? `#popout=${encodeURIComponent(popoutRoute)}` : '';
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.slice(1) });
  }

  return win;
}

void app.whenReady().then(async () => {
  // CSP — dev 빌드에서만 Vite HMR/소스맵의 eval 허용.
  // index.html <meta CSP>는 제거하고 HTTP 헤더로 일원화.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const csp = isDev
      ? "default-src 'self' 'unsafe-eval' 'unsafe-inline'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss: ws://localhost:* http://localhost:*; img-src 'self' data:;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; img-src 'self' data:;";
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  const userDataDir = app.getPath('userData');
  const {
    factory,
    safetyRegistry,
    eventLogger,
    settingsRepo,
    prebuyWatchers,
    boosterWatchers,
    balanceSync,
    dbPath,
  } = bootstrapDeps(userDataDir);

  const backupScheduler = new BackupScheduler({
    dbPath,
    destDirs: [join(userDataDir, 'backups')],
    logger: eventLogger,
  });
  backupScheduler.start();
  // 차수 수동편집(A7) 라우터에서 변경 후 즉시 백업 트리거에 사용.
  factory.setBackupScheduler(backupScheduler);

  // Sentry opt-in 초기화 (DSN 미지정 시 no-op)
  const sentryResult = await initSentryFromSettings({
    settingsRepo,
    isPackaged: app.isPackaged,
  });
  eventLogger.log({
    level: 'INFO',
    category: 'SYS',
    message: sentryResult.active ? 'sentry.initialized' : 'sentry.skipped',
    payload: sentryResult.active
      ? { environment: sentryResult.environment }
      : { reason: sentryResult.reason },
  });

  const win = createMainWindow();
  const ipcHandler = createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () => factory.create(),
  });

  // 팝아웃 창: 메인 화면에서 특정 페이지(logs, reports, settings 등)를 별도 창으로 띄움.
  // route별 1개 창만 유지 — 이미 열려 있으면 포커스만 이동, 닫히면 렌더러에 통지해 placeholder 원복.
  const ALLOWED_POPOUT_ROUTES = new Set(POPOUT_ROUTES);
  const popouts = new Map<PopoutRoute, BrowserWindowType>();
  ipcMain.handle('appShell:openPopout', (event, route: unknown): { ok: boolean } => {
    if (typeof route !== 'string' || !ALLOWED_POPOUT_ROUTES.has(route as PopoutRoute)) {
      return { ok: false };
    }
    const popoutRoute = route as PopoutRoute;
    const existing = popouts.get(popoutRoute);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true };
    }
    // 팝아웃은 호출한 창(부모)이 있는 모니터에 열리도록 parent 전달.
    const sender = BrowserWindow.fromWebContents(event.sender) ?? win;
    const popout = createMainWindow({ popoutRoute, parent: sender });
    popouts.set(popoutRoute, popout);
    ipcHandler.attachWindow(popout);
    popout.on('closed', () => {
      popouts.delete(popoutRoute);
      for (const target of BrowserWindow.getAllWindows()) {
        if (!target.isDestroyed()) target.webContents.send('appShell:popout-closed', popoutRoute);
      }
    });
    return { ok: true };
  });

  // 팝아웃(또는 다른 창)에서 종목을 선택하면 송신자 제외 전 창에 브로드캐스트 — 부모/형제 창의 Trade 페이지가 업데이트
  ipcMain.on('appShell:assignStock', (event, pdno: unknown, name: unknown) => {
    if (typeof pdno !== 'string' || typeof name !== 'string') return;
    if (!/^\d{6}$/.test(pdno)) return;
    for (const target of BrowserWindow.getAllWindows()) {
      if (target.isDestroyed()) continue;
      if (target.webContents.id === event.sender.id) continue;
      target.webContents.send('appShell:stock-assigned', pdno, name);
    }
  });

  // 팝아웃에서 계좌 추가/변경 완료 → 송신자 제외 모든 창에 브로드캐스트(렌더러 query invalidate + 토스트 트리거)
  ipcMain.on('appShell:account-changed', (event, accountId: unknown) => {
    if (typeof accountId !== 'number' || !Number.isInteger(accountId) || accountId <= 0) return;
    for (const target of BrowserWindow.getAllWindows()) {
      if (target.isDestroyed()) continue;
      if (target.webContents.id === event.sender.id) continue;
      target.webContents.send('appShell:account-changed', accountId);
    }
  });

  // 팝아웃 창의 "창 항상 위로" 토글
  ipcMain.handle('appShell:setAlwaysOnTop', (event, on: unknown) => {
    if (typeof on !== 'boolean') return;
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target && !target.isDestroyed()) {
      target.setAlwaysOnTop(on);
    }
  });

  ipcMain.handle('appShell:fitContentHeight', (event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || target.isDestroyed()) return;
    const layout = windowLayoutByWindow.get(target);
    if (!layout?.autoContentHeight) return;
    fitWindowHeightToContent(target, layout, height);
  });

  void import('electron').then(({ globalShortcut }) => {
    const acc = 'CommandOrControl+Shift+K';
    const registered = globalShortcut.register(acc, () => {
      // 등록된 모든 계좌의 master OFF + errorLock 활성. 가장 강한 차단.
      safetyRegistry.triggerKillSwitchAll('글로벌 단축키');
    });
    if (!registered) {
      // 다른 앱이 단축키를 점유 중이면 무시
    }
  });

  void initAutoUpdater(app.isPackaged, eventLogger);

  // BalanceSync / BackupScheduler 종료 시 타이머 해제
  app.once('will-quit', () => {
    balanceSync.dispose();
    backupScheduler.stop();
    for (const watcher of prebuyWatchers.values()) watcher.dispose();
    for (const watcher of boosterWatchers.values()) watcher.dispose();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  void import('electron').then(({ globalShortcut }) => {
    globalShortcut.unregisterAll();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

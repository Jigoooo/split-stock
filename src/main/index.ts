import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
  BrowserWindow as BrowserWindowType,
  IpcMain as IpcMainType,
  safeStorage as safeStorageType,
} from 'electron';
import { createIPCHandler } from 'trpc-electron/main';

// Electron은 CJS-only 모듈. Vite 8(rolldown) + CJS output 조합에서
// `import { app } from 'electron'`이 런타임에 undefined가 되는 interop
// 문제가 있어, createRequire로 직접 require한다.
const electronRequire = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, screen, shell } = electronRequire(
  'electron',
) as {
  app: typeof import('electron').app;
  BrowserWindow: typeof BrowserWindowType;
  ipcMain: IpcMainType;
  nativeTheme: typeof import('electron').nativeTheme;
  safeStorage: typeof safeStorageType;
  screen: typeof import('electron').screen;
  shell: typeof import('electron').shell;
};

// 앱 전반을 라이트 테마로 고정 — 시스템 다크모드 무시.
// macOS 타이틀바, 네이티브 메뉴, 렌더러 color-scheme 모두 light 기반.
nativeTheme.themeSource = 'light';

import type { AppEnv } from '@shared/contracts';
import WebSocket from 'ws';
import { ActiveAccountRepo } from './account/active-account';
import { defaultDbPath, migrate, openDb } from './db/client';
import { SETTING_KEYS, SettingsRepo } from './db/settings-repo';
import { AuthService } from './kis/auth';
import { KIS_BASE_URL } from './kis/endpoints';
import { KisHttpClient } from './kis/http-client';
import { TokenStore } from './kis/token-store';
import { realTimer, type WsLike } from './kis/ws-client';
import { createEventLogger, teeLoggers } from './logging/event-logger';
import { createFileLogger } from './logging/file-logger';
import { initSentryFromSettings } from './monitoring/sentry';
import { FeedBus } from './realtime/feed-bus';
import { RealtimeService } from './realtime/realtime-service';
import { SafetyStateRegistry } from './safety/safety-state';
import { CredentialsRepo } from './security/credentials-repo';
import { DailyCandlesRepo } from './trading/daily-candles-repo';
import { LotsRepo } from './trading/lots-repo';
import { StockMasterRepo } from './trading/stock-master-repo';
import { StockMasterSyncService } from './trading/stock-master-sync';
import { StrategyRepo } from './trading/strategy-repo';
import { WatchEngine } from './trading/watch-engine';
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
  const httpByEnv = {
    MOCK: new KisHttpClient({ baseUrl: KIS_BASE_URL.MOCK }),
    PROD: new KisHttpClient({ baseUrl: KIS_BASE_URL.PROD }),
  };
  const auth = new AuthService(httpByEnv, tokenStore);
  const dbLogger = createEventLogger(db);
  const logsDir = isDev ? join(process.cwd(), 'logs', 'dev') : join(userDataDir, 'logs');
  const fileLogger = createFileLogger({ dir: logsDir, retentionDays: 40 });
  // 부팅 시 1회 로테이션 — 40일 경과 파일 정리
  fileLogger.rotate();
  const eventLogger = teeLoggers(dbLogger, fileLogger);
  // per-account SafetyState 격리 registry. 각 계좌는 자체 master/symbol/errorLock 슬롯.
  const safetyRegistry = new SafetyStateRegistry({ logger: eventLogger });
  const settingsRepo = new SettingsRepo(db);
  const strategyRepo = new StrategyRepo(settingsRepo, eventLogger);
  const stockMasterRepo = new StockMasterRepo(db);
  const stockMasterSync = new StockMasterSyncService(stockMasterRepo, settingsRepo);
  const candlesRepo = new DailyCandlesRepo(db);
  const lotsRepo = new LotsRepo(db);
  const activeAccounts = new ActiveAccountRepo(db);
  // 활성 계좌 보장 — 계좌 0개면 null. 자격증명 저장 시 자동 시드.
  const ensured = activeAccounts.ensureActive();
  const initialActiveAccountId = ensured.isOk() ? ensured.value : null;
  if (ensured.isOk()) {
    // 단일 계좌 시절 strategy 키를 활성 계좌로 이전 (멱등).
    strategyRepo.migrateLegacyKeys(ensured.value);
  }
  // 통합 자동감시주문 엔진 — booster/prebuy/custom을 단일 큐로 관리.
  // BOOSTER/PREBUY 핸들러는 어댑터(BoosterWatcher/PrebuyWatcher) 생성 시 주입됨.
  const watchEngine = new WatchEngine({
    db,
    timer: realTimer,
    handlers: {},
  });
  watchEngine.startCycle();
  // 실시간 버스는 env 전환 상관없이 공유, RealtimeService는 env별 lazy 재생성.
  const bus = new FeedBus();
  const wsFactory = (url: string): WsLike => new WebSocket(url) as unknown as WsLike;
  let lastRealtime: RealtimeService | null = null;
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
    activeAccounts,
    watchEngine,
    bus,
    initialActiveAccountId,
    realtimeFactory: (env) => {
      if (lastRealtime) {
        lastRealtime.stop();
        lastRealtime = null;
      }
      if (env) {
        lastRealtime = new RealtimeService({
          env,
          http: httpByEnv[env],
          bus,
          factory: wsFactory,
          logger: eventLogger,
        });
      }
      return lastRealtime;
    },
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

  return { factory, safetyRegistry, eventLogger, settingsRepo };
}

interface CreateWindowOpts {
  popoutRoute?: string;
  /** 팝아웃 창은 parent가 위치한 모니터에 열리도록 기준 창을 전달 */
  parent?: BrowserWindowType;
}

/** 다중 모니터 환경에서 창을 배치할 Display를 고름. */
function pickTargetDisplay(parent?: BrowserWindowType): Electron.Display {
  if (parent && !parent.isDestroyed()) {
    // 팝아웃: 부모 창의 현재 위치와 가장 많이 겹치는 모니터
    return screen.getDisplayMatching(parent.getBounds());
  }
  // 메인: 커서 위치 기준 모니터 (앱을 실행한 곳으로 간주)
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * 지정 Display의 작업영역을 기준으로 min/max 클램프 + 중앙 배치 좌표 계산.
 * - designedMin이 해당 모니터보다 크면 모니터 크기로 축소 (잘림 방지)
 * - 초기 크기는 중간, 좌표는 작업영역 중앙
 */
function resolveWindowBounds(
  designedMinW: number,
  designedMinH: number,
  display: Electron.Display,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
} {
  const area = display.workArea; // {x, y, width, height} — 실제 스크린 좌표 기준
  const minWidth = Math.min(designedMinW, area.width);
  const minHeight = Math.min(designedMinH, area.height);
  const maxWidth = area.width;
  const maxHeight = area.height;
  const width = Math.min(Math.max(designedMinW + 320, minWidth), maxWidth);
  const height = Math.min(Math.max(designedMinH + 200, minHeight), maxHeight);
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  return { x, y, width, height, minWidth, minHeight, maxWidth, maxHeight };
}

function createMainWindow(opts: CreateWindowOpts = {}): BrowserWindowType {
  const { popoutRoute, parent } = opts;
  const display = pickTargetDisplay(parent);
  const bounds = resolveWindowBounds(popoutRoute ? 720 : 1440, popoutRoute ? 540 : 900, display);
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    maxWidth: bounds.maxWidth,
    maxHeight: bounds.maxHeight,
    show: false,
    autoHideMenuBar: true,
    title: popoutRoute ? `Split Stock · ${popoutRoute}` : 'Split Stock',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.on('ready-to-show', () => win.show());

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
  const { factory, safetyRegistry, eventLogger, settingsRepo } = bootstrapDeps(
    app.getPath('userData'),
  );

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
  const ALLOWED_POPOUT_ROUTES = new Set([
    'dashboard',
    'trade',
    'logs',
    'reports',
    'settings',
    'stock-picker',
  ]);
  const popouts = new Map<string, BrowserWindowType>();
  ipcMain.handle('appShell:openPopout', (event, route: unknown): { ok: boolean } => {
    if (typeof route !== 'string' || !ALLOWED_POPOUT_ROUTES.has(route)) {
      return { ok: false };
    }
    const existing = popouts.get(route);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true };
    }
    // 팝아웃은 호출한 창(부모)이 있는 모니터에 열리도록 parent 전달.
    const sender = BrowserWindow.fromWebContents(event.sender) ?? win;
    const popout = createMainWindow({ popoutRoute: route, parent: sender });
    popouts.set(route, popout);
    ipcHandler.attachWindow(popout);
    popout.on('closed', () => {
      popouts.delete(route);
      for (const target of BrowserWindow.getAllWindows()) {
        if (!target.isDestroyed()) target.webContents.send('appShell:popout-closed', route);
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

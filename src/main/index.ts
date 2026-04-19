import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { BrowserWindow as BrowserWindowType, safeStorage as safeStorageType } from 'electron';
import { createIPCHandler } from 'trpc-electron/main';

// Electron은 CJS-only 모듈. Vite 8(rolldown) + CJS output 조합에서
// `import { app } from 'electron'`이 런타임에 undefined가 되는 interop
// 문제가 있어, createRequire로 직접 require한다.
const electronRequire = createRequire(import.meta.url);
const { app, BrowserWindow, safeStorage, shell } = electronRequire('electron') as {
  app: typeof import('electron').app;
  BrowserWindow: typeof BrowserWindowType;
  safeStorage: typeof safeStorageType;
  shell: typeof import('electron').shell;
};

import type { AppEnv } from '@shared/contracts';
import WebSocket from 'ws';
import { defaultDbPath, migrate, openDb } from './db/client';
import { SETTING_KEYS, SettingsRepo } from './db/settings-repo';
import { AuthService } from './kis/auth';
import { KIS_BASE_URL } from './kis/endpoints';
import { KisHttpClient } from './kis/http-client';
import { TokenStore } from './kis/token-store';
import type { WsLike } from './kis/ws-client';
import { createEventLogger, teeLoggers } from './logging/event-logger';
import { createFileLogger } from './logging/file-logger';
import { initSentryFromSettings } from './monitoring/sentry';
import { FeedBus } from './realtime/feed-bus';
import { RealtimeService } from './realtime/realtime-service';
import { createSafetyState } from './safety/safety-state';
import { CredentialsRepo } from './security/credentials-repo';
import { LotsRepo } from './trading/lots-repo';
import { StockMasterRepo } from './trading/stock-master-repo';
import { StockMasterSyncService } from './trading/stock-master-sync';
import { StrategyRepo } from './trading/strategy-repo';
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
  const safety = createSafetyState({ logger: eventLogger });
  const settingsRepo = new SettingsRepo(db);
  const strategyRepo = new StrategyRepo(settingsRepo, eventLogger);
  const stockMasterRepo = new StockMasterRepo(db);
  const stockMasterSync = new StockMasterSyncService(stockMasterRepo, settingsRepo);
  const lotsRepo = new LotsRepo(db);
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
    safety,
    logger: eventLogger,
    strategyRepo,
    stockMasterRepo,
    stockMasterSync,
    lotsRepo,
    bus,
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
    const cred = credentialsRepo.loadCredentials(savedEnv as AppEnv);
    if (cred.isOk() && cred.value) {
      factory.setEnv(savedEnv as AppEnv);
      eventLogger.log({
        level: 'INFO',
        category: 'AUTH',
        message: 'auth.env.restored',
        payload: { env: savedEnv },
      });
      // 로그인 상태에서 24시간 초과 시 백그라운드로 종목 마스터 동기화.
      // 네트워크 실패는 로그만 남기고 부팅 지연 없이 계속 진행.
      stockMasterSync.syncIfStaleWithLog(eventLogger);
    }
  }

  return { factory, safety, eventLogger, settingsRepo };
}

function createMainWindow(): BrowserWindowType {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'split-stock (MOCK)',
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

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(async () => {
  const { factory, safety, eventLogger, settingsRepo } = bootstrapDeps(app.getPath('userData'));

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
  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () => factory.create(),
  });

  void import('electron').then(({ globalShortcut }) => {
    const acc = 'CommandOrControl+Shift+K';
    const registered = globalShortcut.register(acc, () => {
      safety.triggerKillSwitch('글로벌 단축키');
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

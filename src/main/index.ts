import { join } from 'node:path';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { createIPCHandler } from 'trpc-electron/main';
import { defaultDbPath, migrate, openDb } from './db/client';
import { AuthService } from './kis/auth';
import { KIS_BASE_URL } from './kis/endpoints';
import { KisHttpClient } from './kis/http-client';
import { TokenStore } from './kis/token-store';
import { CredentialsRepo } from './security/credentials-repo';
import { appRouter } from './trpc/app-router';
import { createContextFactory } from './trpc/context';

// __dirname/__filename은 electron.vite.config.ts의 Rollup banner가 주입.
// 별도 폴리필 불필요 — Node 타입 선언으로 TS는 이미 해결됨.

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
  // auth는 env별 분리가 불필요 — http 주입만 분기
  const auth = new AuthService(httpByEnv.MOCK, tokenStore);
  const factory = createContextFactory({ db, credentialsRepo, auth, httpByEnv });
  return { factory };
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'split-stock (MOCK)',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
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

void app.whenReady().then(() => {
  const { factory } = bootstrapDeps(app.getPath('userData'));
  const win = createMainWindow();
  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () => factory.create(),
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import { join } from 'node:path';
import { createIPCHandler } from 'trpc-electron/main';

import { BackupScheduler } from './backup/scheduler';
import { bootstrapDeps } from './bootstrap/bootstrap-deps';
import { app, BrowserWindow, isDev, nativeTheme, session } from './electron-runtime';
import { registerAppShellIpc } from './ipc/app-shell-ipc';
import { markStartup } from './perf/startup-perf';
import { appRouter } from './trpc/app-router';
import { initAutoUpdater } from './updater';
import { constructMainWindow, loadMainWindow } from './windows/main-window';

// 앱 전반을 라이트 테마로 고정 — 시스템 다크모드 무시.
// macOS 타이틀바, 네이티브 메뉴, 렌더러 color-scheme 모두 light 기반.
nativeTheme.themeSource = 'light';

// dev 전용 'unsafe-eval/inline' 경고 숨김 — 패키징 시 엄격 CSP가 적용되므로 무해.
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

void app.whenReady().then(async () => {
  const createAttachedMainWindow = (
    ipcHandler: ReturnType<typeof createIPCHandler>,
  ): Electron.BrowserWindow => {
    const ref = constructMainWindow();
    ipcHandler.attachWindow(ref.window);
    markStartup('window.trpc-attached', { kind: ref.kind, id: ref.window.id });
    loadMainWindow(ref);
    return ref.window;
  };

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
    balanceSync,
    dbPath,
    bootStatus,
  } = bootstrapDeps(userDataDir);

  const backupScheduler = new BackupScheduler({
    dbPath,
    destDirs: [join(userDataDir, 'backups')],
    logger: eventLogger,
    settingsRepo,
  });
  // 차수 수동편집(A7) 라우터에서 변경 후 즉시 백업 트리거에 사용.
  factory.setBackupScheduler(backupScheduler);

  // Sentry 일시 비활성화 — 사용자 facing UI 로 DSN 을 노출할 가치가 낮아 호출만 끔.
  // 코드(monitoring/sentry.ts, monitoring-router, features/error-reporting) 는 흔적으로 유지.
  // 향후 활성화 시 빌드 환경변수(예: process.env.MAIN_VITE_SENTRY_DSN) 로 DSN 을 주입하고
  // 아래 호출만 다시 살리는 형태가 권장. 현재는 settings 의 sentry.dsn 키를 읽는
  // initSentryFromSettings 자체를 호출하지 않음.
  // const sentryResult = await initSentryFromSettings({
  //   settingsRepo,
  //   isPackaged: app.isPackaged,
  // });

  const mainRef = constructMainWindow();
  const ipcHandler = createIPCHandler({
    router: appRouter,
    windows: [mainRef.window],
    createContext: async () => factory.create(),
  });
  markStartup('window.trpc-attached', { kind: mainRef.kind, id: mainRef.window.id });
  registerAppShellIpc({ mainWindow: mainRef.window, ipcHandler });
  loadMainWindow(mainRef);
  bootStatus.markShellReady('main window load started');
  setTimeout(() => {
    backupScheduler.start();
    bootStatus.setFlags({ backupReady: true });
  }, 0);

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
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAttachedMainWindow(ipcHandler);
    }
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

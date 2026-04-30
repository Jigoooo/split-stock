import { createRequire } from 'node:module';
import type {
  BrowserWindow as BrowserWindowType,
  IpcMain as IpcMainType,
  safeStorage as safeStorageType,
  session as sessionType,
} from 'electron';

// Electron은 CJS-only 모듈. Vite 8(rolldown) + CJS output 조합에서
// `import { app } from 'electron'`이 런타임에 undefined가 되는 interop
// 문제가 있어, createRequire로 직접 require한다.
const electronRequire = createRequire(import.meta.url);

export const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  screen,
  session,
  shell,
} = electronRequire('electron') as {
  app: typeof import('electron').app;
  BrowserWindow: typeof BrowserWindowType;
  dialog: typeof import('electron').dialog;
  ipcMain: IpcMainType;
  nativeTheme: typeof import('electron').nativeTheme;
  safeStorage: typeof safeStorageType;
  screen: typeof import('electron').screen;
  session: typeof sessionType;
  shell: typeof import('electron').shell;
};

export const isDev = !app.isPackaged;

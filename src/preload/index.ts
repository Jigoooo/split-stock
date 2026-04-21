import type { WatchOutcomeEvent } from '@shared/contracts';
import { contextBridge, ipcRenderer } from 'electron';
import { exposeElectronTRPC } from 'trpc-electron/main';

exposeElectronTRPC();

contextBridge.exposeInMainWorld('appEnv', {
  platform: process.platform,
  isDev: !process.env.APP_PACKAGED,
});

/**
 * 팝아웃 창 브릿지.
 * - openPopout(route): main 프로세스가 별도 BrowserWindow를 생성해 해당 route 페이지만 렌더.
 * - onPopoutClosed(listener): 팝아웃 창이 닫혔을 때 열린 route 상태를 갱신하도록 알림.
 */
contextBridge.exposeInMainWorld('appShell', {
  openPopout: (route: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('appShell:openPopout', route),
  onPopoutClosed: (listener: (route: string) => void): (() => void) => {
    const handler = (_: unknown, route: string): void => listener(route);
    ipcRenderer.on('appShell:popout-closed', handler);
    return () => ipcRenderer.off('appShell:popout-closed', handler);
  },
  assignStock: (pdno: string, name: string): void => {
    ipcRenderer.send('appShell:assignStock', pdno, name);
  },
  onStockAssigned: (listener: (pdno: string, name: string) => void): (() => void) => {
    const handler = (_: unknown, pdno: string, name: string): void => listener(pdno, name);
    ipcRenderer.on('appShell:stock-assigned', handler);
    return () => ipcRenderer.off('appShell:stock-assigned', handler);
  },
  /** 계좌 추가/변경을 다른 창에 통지 — 메인 창 등에서 query invalidate + 토스트 트리거. */
  broadcastAccountChanged: (accountId: number): void => {
    ipcRenderer.send('appShell:account-changed', accountId);
  },
  onAccountChanged: (listener: (accountId: number) => void): (() => void) => {
    const handler = (_: unknown, accountId: number): void => listener(accountId);
    ipcRenderer.on('appShell:account-changed', handler);
    return () => ipcRenderer.off('appShell:account-changed', handler);
  },
  onWatchEvent: (listener: (event: WatchOutcomeEvent) => void): (() => void) => {
    const handler = (_: unknown, event: WatchOutcomeEvent): void => listener(event);
    ipcRenderer.on('appShell:watch-event', handler);
    return () => ipcRenderer.off('appShell:watch-event', handler);
  },
  setAlwaysOnTop: (on: boolean): Promise<void> => ipcRenderer.invoke('appShell:setAlwaysOnTop', on),
  fitContentHeight: (height: number): Promise<void> =>
    ipcRenderer.invoke('appShell:fitContentHeight', height),
});

export type AppEnvBridge = {
  platform: NodeJS.Platform;
  isDev: boolean;
};

export type AppShellBridge = {
  openPopout: (route: string) => Promise<{ ok: boolean }>;
  onPopoutClosed: (listener: (route: string) => void) => () => void;
  assignStock: (pdno: string, name: string) => void;
  onStockAssigned: (listener: (pdno: string, name: string) => void) => () => void;
  broadcastAccountChanged: (accountId: number) => void;
  onAccountChanged: (listener: (accountId: number) => void) => () => void;
  onWatchEvent?: (listener: (event: WatchOutcomeEvent) => void) => () => void;
  setAlwaysOnTop: (on: boolean) => Promise<void>;
  fitContentHeight: (height: number) => Promise<void>;
};

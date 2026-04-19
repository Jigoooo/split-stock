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
 * - onPopoutClosed(listener): 팝아웃 창이 닫혔을 때 메인 그리드의 placeholder를 원복하도록 알림.
 */
contextBridge.exposeInMainWorld('appShell', {
  openPopout: (route: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('appShell:openPopout', route),
  onPopoutClosed: (listener: (route: string) => void): (() => void) => {
    const handler = (_: unknown, route: string): void => listener(route);
    ipcRenderer.on('appShell:popout-closed', handler);
    return () => ipcRenderer.off('appShell:popout-closed', handler);
  },
});

export type AppEnvBridge = {
  platform: NodeJS.Platform;
  isDev: boolean;
};

export type AppShellBridge = {
  openPopout: (route: string) => Promise<{ ok: boolean }>;
  onPopoutClosed: (listener: (route: string) => void) => () => void;
};

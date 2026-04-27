import type { TradeExecutionEvent, WatchOutcomeEvent } from '@shared/contracts';
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
  /** 계좌 추가/변경을 다른 창에 통지 — 메인 창 등에서 query invalidate + 토스트 트리거.
   *  meta.envSwitchedTo 가 있으면 첫 계좌 자동 활성화로 메인 창 환경이 전환됐음을 알림. */
  broadcastAccountChanged: (
    accountId: number,
    meta?: { envSwitchedTo?: 'PROD' | 'MOCK' },
  ): void => {
    ipcRenderer.send('appShell:account-changed', accountId, meta ?? null);
  },
  onAccountChanged: (
    listener: (accountId: number, meta?: { envSwitchedTo?: 'PROD' | 'MOCK' } | null) => void,
  ): (() => void) => {
    const handler = (
      _: unknown,
      accountId: number,
      meta?: { envSwitchedTo?: 'PROD' | 'MOCK' } | null,
    ): void => listener(accountId, meta);
    ipcRenderer.on('appShell:account-changed', handler);
    return () => ipcRenderer.off('appShell:account-changed', handler);
  },
  /**
   * 설정 변경(매매/보호/시간대/자동감시/안전/백업/표시 등)을 다른 창에 통지 — 모든 popout 윈도우와
   * 부모창이 query invalidate 로 동기화한다. scope 는 사용자가 어떤 도메인을 수정했는지 알리는 hint
   * (옵션). 리스너는 그냥 전체 invalidateQueries 로 처리해도 된다.
   */
  broadcastSettingsChanged: (scope?: string): void => {
    ipcRenderer.send('appShell:settings-changed', scope ?? 'all');
  },
  onSettingsChanged: (listener: (scope: string) => void): (() => void) => {
    const handler = (_: unknown, scope: string): void => listener(scope);
    ipcRenderer.on('appShell:settings-changed', handler);
    return () => ipcRenderer.off('appShell:settings-changed', handler);
  },
  onWatchEvent: (listener: (event: WatchOutcomeEvent) => void): (() => void) => {
    const handler = (_: unknown, event: WatchOutcomeEvent): void => listener(event);
    ipcRenderer.on('appShell:watch-event', handler);
    return () => ipcRenderer.off('appShell:watch-event', handler);
  },
  onTradeEvent: (listener: (event: TradeExecutionEvent) => void): (() => void) => {
    const handler = (_: unknown, event: TradeExecutionEvent): void => listener(event);
    ipcRenderer.on('appShell:trade-event', handler);
    return () => ipcRenderer.off('appShell:trade-event', handler);
  },
  onQuoteFeedCooldown: (
    listener: (event: { pdno: string; failures: number; reason: string }) => void,
  ): (() => void) => {
    const handler = (_: unknown, event: { pdno: string; failures: number; reason: string }): void =>
      listener(event);
    ipcRenderer.on('appShell:quote-feed-cooldown', handler);
    return () => ipcRenderer.off('appShell:quote-feed-cooldown', handler);
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
  broadcastAccountChanged: (
    accountId: number,
    meta?: { envSwitchedTo?: 'PROD' | 'MOCK' },
  ) => void;
  onAccountChanged: (
    listener: (accountId: number, meta?: { envSwitchedTo?: 'PROD' | 'MOCK' } | null) => void,
  ) => () => void;
  broadcastSettingsChanged: (scope?: string) => void;
  onSettingsChanged: (listener: (scope: string) => void) => () => void;
  onWatchEvent?: (listener: (event: WatchOutcomeEvent) => void) => () => void;
  onTradeEvent?: (listener: (event: TradeExecutionEvent) => void) => () => void;
  onQuoteFeedCooldown?: (
    listener: (event: { pdno: string; failures: number; reason: string }) => void,
  ) => () => void;
  setAlwaysOnTop: (on: boolean) => Promise<void>;
  fitContentHeight: (height: number) => Promise<void>;
};

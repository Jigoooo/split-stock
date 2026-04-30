import { POPOUT_ROUTES, type PopoutRoute } from '@shared/popout';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { BrowserWindow, ipcMain } from '../electron-runtime';
import { markStartup } from '../perf/startup-perf';
import {
  constructMainWindow,
  fitWindowHeightToContent,
  loadMainWindow,
} from '../windows/main-window';

interface TrpcWindowHandler {
  attachWindow: (window: BrowserWindowType) => void;
}

export function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (target.isDestroyed()) continue;
    target.webContents.send(channel, ...args);
  }
}

function broadcastToOtherWindows(
  senderWebContentsId: number,
  channel: string,
  ...args: unknown[]
): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (target.isDestroyed()) continue;
    if (target.webContents.id === senderWebContentsId) continue;
    target.webContents.send(channel, ...args);
  }
}

export function registerAppShellIpc(input: {
  mainWindow: BrowserWindowType;
  ipcHandler: TrpcWindowHandler;
}): void {
  const { mainWindow, ipcHandler } = input;
  const allowedPopoutRoutes = new Set(POPOUT_ROUTES);
  const popouts = new Map<PopoutRoute, BrowserWindowType>();

  // 팝아웃 창: 메인 화면에서 특정 페이지(logs, reports, settings 등)를 별도 창으로 띄움.
  // route별 1개 창만 유지 — 이미 열려 있으면 포커스만 이동, 닫히면 렌더러에 통지해 placeholder 원복.
  ipcMain.handle('appShell:openPopout', (event, route: unknown): { ok: boolean } => {
    if (typeof route !== 'string' || !allowedPopoutRoutes.has(route as PopoutRoute)) {
      return { ok: false };
    }
    const popoutRoute = route as PopoutRoute;
    markStartup('popout.request', { route: popoutRoute });
    const existing = popouts.get(popoutRoute);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      markStartup('popout.focus-existing', { route: popoutRoute, id: existing.id });
      return { ok: true };
    }
    // 팝아웃은 호출한 창(부모)이 있는 모니터에 열리도록 parent 전달.
    const sender = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const popoutRef = constructMainWindow({
      popoutRoute,
      parent: sender,
      showPolicy: 'immediate-with-background',
    });
    const popout = popoutRef.window;
    popouts.set(popoutRoute, popout);
    ipcHandler.attachWindow(popout);
    markStartup('window.trpc-attached', {
      kind: popoutRef.kind,
      route: popoutRoute,
      id: popout.id,
    });
    popout.on('closed', () => {
      popouts.delete(popoutRoute);
      broadcastToAllWindows('appShell:popout-closed', popoutRoute);
    });
    loadMainWindow(popoutRef);
    return { ok: true };
  });

  // 팝아웃(또는 다른 창)에서 종목을 선택하면 송신자 제외 전 창에 브로드캐스트 — 부모/형제 창의 Trade 페이지가 업데이트
  ipcMain.on('appShell:assignStock', (event, pdno: unknown, name: unknown) => {
    if (typeof pdno !== 'string' || typeof name !== 'string') return;
    if (!/^\d{6}$/.test(pdno)) return;
    broadcastToOtherWindows(event.sender.id, 'appShell:stock-assigned', pdno, name);
  });

  // 팝아웃에서 계좌 추가/변경 완료 → 송신자 제외 모든 창에 브로드캐스트(렌더러 query invalidate + 토스트 트리거)
  // meta: { envSwitchedTo?: 'PROD' | 'MOCK' } — 첫 계좌 자동 활성화로 환경이 전환됐을 때 수신측에서 토스트 강조.
  ipcMain.on('appShell:account-changed', (event, accountId: unknown, meta: unknown) => {
    if (typeof accountId !== 'number' || !Number.isInteger(accountId) || accountId <= 0) return;
    const safeMeta =
      meta && typeof meta === 'object' && 'envSwitchedTo' in meta
        ? { envSwitchedTo: (meta as { envSwitchedTo?: unknown }).envSwitchedTo }
        : null;
    const cleanMeta =
      safeMeta && (safeMeta.envSwitchedTo === 'PROD' || safeMeta.envSwitchedTo === 'MOCK')
        ? safeMeta
        : null;
    broadcastToOtherWindows(event.sender.id, 'appShell:account-changed', accountId, cleanMeta);
  });

  // 어느 창이든 설정 변경 → 송신자 제외 모든 창에 브로드캐스트.
  // 각 창은 onSettingsChanged 리스너에서 query invalidate 로 동기화한다.
  ipcMain.on('appShell:settings-changed', (event, scope: unknown) => {
    const safeScope = typeof scope === 'string' ? scope : 'all';
    broadcastToOtherWindows(event.sender.id, 'appShell:settings-changed', safeScope);
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
    fitWindowHeightToContent(target, height);
  });

  ipcMain.on('appShell:route-ready', (event, route: unknown) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    markStartup('renderer.route-ready', {
      id: target?.id ?? null,
      route: typeof route === 'string' ? route : null,
    });
  });
}

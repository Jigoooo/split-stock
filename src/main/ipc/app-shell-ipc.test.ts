import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeWebContents {
    static nextId = 100;
    id = FakeWebContents.nextId++;
    listeners = new Map<string, Listener[]>();
    send = vi.fn();
    on(event: string, listener: Listener): void {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  class FakeBrowserWindow {
    static nextId = 1;
    static all: FakeBrowserWindow[] = [];
    static getAllWindows = vi.fn(() => FakeBrowserWindow.all);
    static fromWebContents = vi.fn(
      (target: FakeWebContents) =>
        FakeBrowserWindow.all.find((win) => win.webContents === target) ?? null,
    );

    id = FakeBrowserWindow.nextId++;
    webContents = new FakeWebContents();
    destroyed = false;
    minimized = false;
    visible = false;
    listeners = new Map<string, Listener[]>();
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    hide = vi.fn(() => {
      this.visible = false;
    });
    restore = vi.fn(() => {
      this.minimized = false;
    });
    destroy = vi.fn(() => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    });

    constructor() {
      FakeBrowserWindow.all.push(this);
    }

    on(event: string, listener: Listener): void {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isMinimized(): boolean {
      return this.minimized;
    }
  }

  return {
    FakeBrowserWindow,
    handles: new Map<string, Listener>(),
    listeners: new Map<string, Listener>(),
    appOnce: vi.fn(),
    attachWindow: vi.fn(),
    constructMainWindow: vi.fn(),
    loadMainWindow: vi.fn(),
    fitWindowHeightToContent: vi.fn(),
    markStartup: vi.fn(),
  };
});

vi.mock('../electron-runtime', () => ({
  app: { once: fakes.appOnce },
  BrowserWindow: fakes.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      fakes.handles.set(channel, listener);
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      fakes.listeners.set(channel, listener);
    },
  },
}));

vi.mock('../windows/main-window', () => ({
  constructMainWindow: fakes.constructMainWindow,
  fitWindowHeightToContent: fakes.fitWindowHeightToContent,
  loadMainWindow: fakes.loadMainWindow,
}));

vi.mock('../perf/startup-perf', () => ({
  markStartup: fakes.markStartup,
}));

function closeEvent(): { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() };
}

async function setup() {
  vi.resetModules();
  const mainWindow = new fakes.FakeBrowserWindow();
  fakes.constructMainWindow.mockImplementation(({ popoutRoute }: { popoutRoute: string }) => ({
    kind: 'popout',
    popoutRoute,
    showPolicy: 'renderer-shell-ready',
    window: new fakes.FakeBrowserWindow(),
  }));
  const { registerAppShellIpc } = await import('./app-shell-ipc');
  registerAppShellIpc({
    mainWindow: mainWindow as unknown as Electron.BrowserWindow,
    ipcHandler: { attachWindow: fakes.attachWindow },
  });
  const openPopout = fakes.handles.get('appShell:openPopout');
  const shellReady = fakes.listeners.get('appShell:popout-shell-ready');
  if (!openPopout || !shellReady) throw new Error('popout IPC handlers not registered');
  return { mainWindow, openPopout, shellReady };
}

describe('app-shell popout lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakes.FakeBrowserWindow.nextId = 1;
    fakes.FakeBrowserWindow.all = [];
    fakes.handles.clear();
    fakes.listeners.clear();
    fakes.appOnce.mockClear();
    fakes.attachWindow.mockClear();
    fakes.constructMainWindow.mockReset();
    fakes.loadMainWindow.mockClear();
    fakes.fitWindowHeightToContent.mockClear();
    fakes.markStartup.mockClear();
  });

  it('renderer shell-ready 전에는 첫 팝아웃을 show하지 않는다', async () => {
    const { mainWindow, openPopout, shellReady } = await setup();

    openPopout({ sender: mainWindow.webContents }, 'logs');
    const popout = fakes.FakeBrowserWindow.all.at(-1);

    expect(popout?.show).not.toHaveBeenCalled();
    shellReady({ sender: popout?.webContents }, 'logs');

    expect(popout?.show).toHaveBeenCalledTimes(1);
    expect(popout?.focus).toHaveBeenCalledTimes(1);
    expect(popout?.webContents.send).toHaveBeenCalledWith(
      'appShell:popout-activated',
      'logs',
      expect.any(Number),
    );
  });

  it('shell-ready가 누락되면 timeout으로 팝아웃을 보여준다', async () => {
    const { mainWindow, openPopout } = await setup();

    openPopout({ sender: mainWindow.webContents }, 'logs');
    const popout = fakes.FakeBrowserWindow.all.at(-1);
    vi.advanceTimersByTime(799);
    expect(popout?.show).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(popout?.show).toHaveBeenCalledTimes(1);
  });

  it('사용자 close는 destroy 대신 hide하고 reopen은 같은 창을 재사용한다', async () => {
    const { mainWindow, openPopout, shellReady } = await setup();

    openPopout({ sender: mainWindow.webContents }, 'logs');
    const popout = fakes.FakeBrowserWindow.all.at(-1);
    shellReady({ sender: popout?.webContents }, 'logs');

    const event = closeEvent();
    popout?.emit('close', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(popout?.hide).toHaveBeenCalledTimes(1);
    expect(popout?.destroy).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('appShell:popout-closed', 'logs');

    openPopout({ sender: mainWindow.webContents }, 'logs');

    expect(fakes.constructMainWindow).toHaveBeenCalledTimes(1);
    expect(popout?.show).toHaveBeenCalledTimes(2);
    expect(popout?.focus).toHaveBeenCalledTimes(2);
  });

  it('hidden cache limit을 넘으면 가장 오래 숨긴 팝아웃을 destroy한다', async () => {
    const { mainWindow, openPopout, shellReady } = await setup();

    for (const route of ['logs', 'reports', 'settings']) {
      openPopout({ sender: mainWindow.webContents }, route);
      const popout = fakes.FakeBrowserWindow.all.at(-1);
      shellReady({ sender: popout?.webContents }, route);
      popout?.emit('close', closeEvent());
      vi.advanceTimersByTime(1);
    }

    const [, logs] = fakes.FakeBrowserWindow.all;
    expect(logs?.destroy).toHaveBeenCalledTimes(1);
  });

  it('hidden TTL이 지나면 숨겨진 팝아웃을 destroy한다', async () => {
    const { mainWindow, openPopout, shellReady } = await setup();

    openPopout({ sender: mainWindow.webContents }, 'logs');
    const popout = fakes.FakeBrowserWindow.all.at(-1);
    shellReady({ sender: popout?.webContents }, 'logs');
    popout?.emit('close', closeEvent());

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(popout?.destroy).toHaveBeenCalledTimes(1);
  });
});

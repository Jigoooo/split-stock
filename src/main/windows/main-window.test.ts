import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadFile = vi.fn();
const loadUrl = vi.fn();
const show = vi.fn();
const setWindowOpenHandler = vi.fn();

class FakeBrowserWindow {
  static nextId = 1;
  id = FakeBrowserWindow.nextId++;
  webContents = {
    id: this.id + 100,
    setWindowOpenHandler,
    openDevTools: vi.fn(),
  };
  private bounds = { x: 0, y: 0, width: 1000, height: 800 };
  private contentBounds = { x: 0, y: 0, width: 1000, height: 760 };

  constructor(readonly options: Record<string, unknown>) {
    this.bounds = {
      x: Number(options.x ?? 0),
      y: Number(options.y ?? 0),
      width: Number(options.width ?? 1000),
      height: Number(options.height ?? 800),
    };
  }

  on(): void {}
  once(): void {}
  isDestroyed(): boolean {
    return false;
  }
  getBounds(): Electron.Rectangle {
    return this.bounds;
  }
  getContentBounds(): Electron.Rectangle {
    return this.contentBounds;
  }
  setMinimumSize(): void {}
  setMaximumSize(): void {}
  setBounds(bounds: Partial<Electron.Rectangle>): void {
    this.bounds = { ...this.bounds, ...bounds };
  }
  show(): void {
    show();
  }
  loadURL(url: string): void {
    loadUrl(url);
  }
  loadFile(path: string, options?: Record<string, unknown>): void {
    loadFile(path, options);
  }
}

vi.mock('../electron-runtime', () => ({
  BrowserWindow: FakeBrowserWindow,
  isDev: false,
  screen: {
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    on: vi.fn(),
    off: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../perf/startup-perf', () => ({
  markStartup: vi.fn(),
}));

describe('main-window lifecycle', () => {
  beforeEach(() => {
    loadFile.mockClear();
    loadUrl.mockClear();
    show.mockClear();
    setWindowOpenHandler.mockClear();
    FakeBrowserWindow.nextId = 1;
  });

  it('constructMainWindow는 renderer load를 시작하지 않는다', async () => {
    const { constructMainWindow } = await import('./main-window');
    const ref = constructMainWindow();

    expect(ref.kind).toBe('main');
    expect(loadFile).not.toHaveBeenCalled();
    expect(loadUrl).not.toHaveBeenCalled();
  });

  it('loadMainWindow 호출 시점에만 loadFile을 시작한다', async () => {
    const { constructMainWindow, loadMainWindow } = await import('./main-window');
    const ref = constructMainWindow({ popoutRoute: 'logs' });

    loadMainWindow(ref);

    expect(loadFile).toHaveBeenCalledWith(expect.stringContaining('index.html'), {
      hash: '/popout/logs',
    });
  });
});

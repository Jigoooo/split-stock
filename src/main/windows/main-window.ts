import { join } from 'node:path';
import { getPopoutRouteConfig, getPopoutWindowTitle, type PopoutRoute } from '@shared/popout';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { BrowserWindow, isDev, screen, shell } from '../electron-runtime';
import { markStartup } from '../perf/startup-perf';

export interface CreateWindowOpts {
  popoutRoute?: PopoutRoute;
  /** 팝아웃 창은 parent가 위치한 모니터에 열리도록 기준 창을 전달 */
  parent?: BrowserWindowType;
  showPolicy?: WindowShowPolicy;
}

export type WindowKind = 'main' | 'popout';
export type WindowShowPolicy =
  | 'ready-to-show'
  | 'immediate-with-background'
  | 'renderer-shell-ready';

export interface ConstructedMainWindow {
  window: BrowserWindowType;
  kind: WindowKind;
  popoutRoute?: PopoutRoute;
  showPolicy: WindowShowPolicy;
}

interface WindowLayoutSpec {
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  autoContentHeight?: boolean;
}

const MAIN_WINDOW_LAYOUT: WindowLayoutSpec = {
  title: 'Split Stock',
  defaultWidth: 1760,
  defaultHeight: 1100,
  minWidth: 1440,
  minHeight: 900,
};

const windowLayoutByWindow = new WeakMap<BrowserWindowType, WindowLayoutSpec>();

/** 다중 모니터 환경에서 창을 배치할 Display를 고름. */
function pickTargetDisplay(parent?: BrowserWindowType): Electron.Display {
  if (parent && !parent.isDestroyed()) {
    // 팝아웃: 부모 창의 현재 위치와 가장 많이 겹치는 모니터
    return screen.getDisplayMatching(parent.getBounds());
  }
  // 메인: 커서 위치 기준 모니터 (앱을 실행한 곳으로 간주)
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function getWindowLayout(popoutRoute?: PopoutRoute): WindowLayoutSpec {
  if (!popoutRoute) return MAIN_WINDOW_LAYOUT;
  return getPopoutRouteConfig(popoutRoute);
}

function clampWindowSize(value: number, minValue: number | undefined, maxValue: number): number {
  return Math.min(Math.max(value, minValue ?? 0), maxValue);
}

function resolveWindowConstraints(
  layout: WindowLayoutSpec,
  display: Electron.Display,
): {
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
} {
  const area = display.workArea;
  const minWidth =
    layout.minWidth === undefined ? undefined : Math.min(layout.minWidth, area.width);
  const minHeight =
    layout.minHeight === undefined ? undefined : Math.min(layout.minHeight, area.height);
  const maxWidth = area.width;
  const maxHeight = area.height;
  return { minWidth, minHeight, maxWidth, maxHeight };
}

/**
 * 지정 Display의 작업영역을 기준으로 min/max 클램프 + 중앙 배치 좌표 계산.
 */
function resolveWindowBounds(
  layout: WindowLayoutSpec,
  display: Electron.Display,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
} {
  const area = display.workArea;
  const { minWidth, minHeight, maxWidth, maxHeight } = resolveWindowConstraints(layout, display);
  const width = clampWindowSize(layout.defaultWidth, minWidth, maxWidth);
  const height = clampWindowSize(layout.defaultHeight, minHeight, maxHeight);
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  return { x, y, width, height, minWidth, minHeight, maxWidth, maxHeight };
}

function constrainWindowBounds(input: {
  area: Electron.Rectangle;
  current: Electron.Rectangle;
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
  clampPosition: boolean;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = clampWindowSize(input.current.width, input.minWidth, input.maxWidth);
  const height = clampWindowSize(input.current.height, input.minHeight, input.maxHeight);

  if (!input.clampPosition) {
    return {
      x: input.current.x,
      y: input.current.y,
      width,
      height,
    };
  }

  const maxX = input.area.x + input.area.width - width;
  const maxY = input.area.y + input.area.height - height;
  return {
    x: Math.min(Math.max(input.current.x, input.area.x), maxX),
    y: Math.min(Math.max(input.current.y, input.area.y), maxY),
    width,
    height,
  };
}

function applyDisplayConstraints(
  win: BrowserWindowType,
  layout: WindowLayoutSpec,
  options: { clampPosition: boolean } = { clampPosition: true },
): void {
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  const { minWidth, minHeight, maxWidth, maxHeight } = resolveWindowConstraints(layout, display);
  const current = win.getBounds();
  const { x, y, width, height } = constrainWindowBounds({
    area,
    current,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    clampPosition: options.clampPosition,
  });

  win.setMinimumSize(minWidth ?? 0, minHeight ?? 0);
  win.setMaximumSize(maxWidth, maxHeight);

  if (x !== current.x || y !== current.y || width !== current.width || height !== current.height) {
    win.setBounds({ x, y, width, height });
  }
}

function bindDisplayConstraints(win: BrowserWindowType, layout: WindowLayoutSpec): void {
  let syncing = false;
  const sync = (options: { clampPosition: boolean }): void => {
    if (syncing || win.isDestroyed()) return;
    syncing = true;
    try {
      applyDisplayConstraints(win, layout, options);
    } finally {
      syncing = false;
    }
  };

  const handleDisplayChange = (): void => sync({ clampPosition: true });
  win.on('move', () => sync({ clampPosition: false }));
  win.on('resize', () => sync({ clampPosition: true }));
  screen.on('display-metrics-changed', handleDisplayChange);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  win.once('closed', () => {
    screen.off('display-metrics-changed', handleDisplayChange);
    screen.off('display-added', handleDisplayChange);
    screen.off('display-removed', handleDisplayChange);
  });
}

export function fitWindowHeightToContent(win: BrowserWindowType, contentHeight: number): void {
  const layout = windowLayoutByWindow.get(win);
  if (!layout?.autoContentHeight) return;

  const display = screen.getDisplayMatching(win.getBounds());
  const { minHeight, maxHeight } = resolveWindowConstraints(layout, display);
  const bounds = win.getBounds();
  const contentBounds = win.getContentBounds();
  const frameHeight = Math.max(0, bounds.height - contentBounds.height);
  const nextHeight = clampWindowSize(Math.ceil(contentHeight + frameHeight), minHeight, maxHeight);
  if (nextHeight === bounds.height) return;

  const area = display.workArea;
  const nextY = Math.min(Math.max(bounds.y, area.y), area.y + area.height - nextHeight);
  win.setBounds({ x: bounds.x, y: nextY, width: bounds.width, height: nextHeight });
}

export function constructMainWindow(opts: CreateWindowOpts = {}): ConstructedMainWindow {
  const { popoutRoute, parent, showPolicy = 'ready-to-show' } = opts;
  const display = pickTargetDisplay(parent);
  const layout = getWindowLayout(popoutRoute);
  const bounds = resolveWindowBounds(layout, display);
  const kind: WindowKind = popoutRoute ? 'popout' : 'main';
  markStartup('window.construct.start', { kind, route: popoutRoute ?? null });
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(bounds.minWidth !== undefined ? { minWidth: bounds.minWidth } : {}),
    ...(bounds.minHeight !== undefined ? { minHeight: bounds.minHeight } : {}),
    maxWidth: bounds.maxWidth,
    maxHeight: bounds.maxHeight,
    show: false,
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    title: popoutRoute ? getPopoutWindowTitle(popoutRoute) : layout.title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });
  windowLayoutByWindow.set(win, layout);
  bindDisplayConstraints(win, layout);

  win.on('ready-to-show', () => {
    markStartup('window.ready-to-show', { kind, route: popoutRoute ?? null, id: win.id });
    if (showPolicy === 'ready-to-show') {
      win.show();
      markStartup('window.show', { kind, route: popoutRoute ?? null, id: win.id, showPolicy });
    }
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  markStartup('window.construct.end', { kind, route: popoutRoute ?? null, id: win.id });
  return { window: win, kind, ...(popoutRoute ? { popoutRoute } : {}), showPolicy };
}

export function loadMainWindow(ref: ConstructedMainWindow): void {
  const { window: win, popoutRoute, kind, showPolicy } = ref;
  const hash = popoutRoute ? `/popout/${encodeURIComponent(popoutRoute)}` : '';
  markStartup('window.load.start', { kind, route: popoutRoute ?? null, id: win.id });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  }
  if (showPolicy === 'immediate-with-background') {
    win.show();
    markStartup('window.show', { kind, route: popoutRoute ?? null, id: win.id, showPolicy });
  }
}

export function createMainWindow(opts: CreateWindowOpts = {}): BrowserWindowType {
  const ref = constructMainWindow(opts);
  loadMainWindow(ref);
  return ref.window;
}

export interface PopoutRouteConfig {
  label: string;
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  autoContentHeight?: boolean;
}

export const POPOUT_ROUTE_CONFIG = {
  trade: {
    label: '트레이드',
    title: 'Split Stock · 트레이드',
    defaultWidth: 1040,
    defaultHeight: 740,
    minWidth: 720,
    minHeight: 540,
  },
  logs: {
    label: '이벤트 로그',
    title: 'Split Stock · 이벤트 로그',
    defaultWidth: 1040,
    defaultHeight: 740,
    minWidth: 720,
    minHeight: 540,
  },
  reports: {
    label: '리포트',
    title: 'Split Stock · 리포트',
    defaultWidth: 1040,
    defaultHeight: 740,
    minWidth: 720,
    minHeight: 540,
  },
  settings: {
    label: '설정',
    title: 'Split Stock · 설정',
    defaultWidth: 1040,
    defaultHeight: 880,
    minWidth: 720,
    minHeight: 640,
  },
  'stock-picker': {
    label: '종목 선택',
    title: 'Split Stock · 종목 선택',
    defaultWidth: 1040,
    defaultHeight: 740,
    minWidth: 720,
    minHeight: 540,
  },
  'profit-calculator': {
    label: '수익률 계산기',
    title: 'Split Stock · 수익률 계산기',
    defaultWidth: 700,
    defaultHeight: 620,
    minWidth: 380,
    minHeight: 420,
  },
  'add-account': {
    label: '계좌 추가',
    title: 'Split Stock · 계좌 추가',
    // Stage 5b: 증권사 선택 카드 row 가 추가되어 세로 100px+ 가량 확장.
    // 카드 두 개를 가로 배치하기 위해 width 도 약간 넓힘.
    defaultWidth: 460,
    defaultHeight: 560,
    minWidth: 420,
    minHeight: 520,
  },
  'add-watch-order': {
    label: '자동감시 추가',
    title: 'Split Stock · 자동감시 추가',
    defaultWidth: 1080,
    defaultHeight: 880,
    minWidth: 760,
    autoContentHeight: true,
  },
} as const satisfies Record<string, PopoutRouteConfig>;

export type PopoutRoute = keyof typeof POPOUT_ROUTE_CONFIG;

export const POPOUT_ROUTES = Object.freeze(Object.keys(POPOUT_ROUTE_CONFIG) as PopoutRoute[]);

export function isPopoutRoute(value: string): value is PopoutRoute {
  return Object.hasOwn(POPOUT_ROUTE_CONFIG, value);
}

export function getPopoutRouteConfig(route: PopoutRoute): PopoutRouteConfig {
  return POPOUT_ROUTE_CONFIG[route];
}

export function getPopoutWindowTitle(route: PopoutRoute): string {
  return getPopoutRouteConfig(route).title;
}

export function getPopoutLabel(route: PopoutRoute): string {
  return getPopoutRouteConfig(route).label;
}

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
    // 로그는 timestamp + payload preview 를 한 화면에서 비교해야 하므로
    // 일반 팝아웃보다 넓은 기본 폭을 사용한다.
    defaultWidth: 1280,
    defaultHeight: 860,
    minWidth: 900,
    minHeight: 640,
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
    // 단계형 흐름(증권사·환경·자격증명·계좌·별칭) + 자격증명/계좌정보 grid 2열 배치.
    // 컴팩트 padding/gap 적용 후 5개 섹션이 640px 안쪽에 자연스럽게 들어감.
    defaultWidth: 820,
    defaultHeight: 500,
    minWidth: 700,
    minHeight: 500,
  },
  'add-watch-order': {
    label: '자동감시 추가',
    title: 'Split Stock · 자동감시 추가',
    defaultWidth: 1240,
    defaultHeight: 880,
    minWidth: 900,
    autoContentHeight: true,
  },
  'add-crypto-watch': {
    label: '코인 자동감시 추가',
    title: 'Split Stock · 코인 자동감시 추가',
    defaultWidth: 1040,
    defaultHeight: 820,
    minWidth: 860,
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

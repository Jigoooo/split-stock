import type { AppEnv } from '@shared/contracts';

/**
 * Kiwoom Open API base URLs (공식: https://openapi.kiwoom.com/guide/apiguide).
 * MOCK 환경은 KRX 만 지원 (NXT/SOR 라우팅은 PROD 전용).
 */
export const KIWOOM_BASE_URL: Record<AppEnv, string> = {
  MOCK: 'https://mockapi.kiwoom.com',
  PROD: 'https://api.kiwoom.com',
};

/**
 * Kiwoom WebSocket endpoints. JSON 프로토콜 (LOGIN/REG/REMOVE/REAL).
 */
export const KIWOOM_WS_URL: Record<AppEnv, string> = {
  MOCK: 'wss://mockapi.kiwoom.com:10000/api/dostk/websocket',
  PROD: 'wss://api.kiwoom.com:10000/api/dostk/websocket',
};

/** REST endpoint paths (api-id 헤더로 분기). */
export const KIWOOM_PATH = {
  /** OAuth 토큰 발급/폐기. */
  TOKEN: '/oauth2/token',
  TOKEN_REVOKE: '/oauth2/revoke',
  /** 주문 (kt10000~kt10003). */
  ORDER: '/api/dostk/ordr',
  /** 계좌/체결/잔고 (kt00018, ka10075, ka10076 등). */
  ACCOUNT: '/api/dostk/acnt',
  /** 시세/호가 (ka10004, ka10006 등). */
  MARKET_CONDITION: '/api/dostk/mrkcond',
  /** 차트 (ka10081/82/83). */
  CHART: '/api/dostk/chart',
  /** 종목정보 (ka10001~). */
  STOCK_INFO: '/api/dostk/stkinfo',
} as const;

/**
 * api-id 매핑 — KiwoomRestApi.Net 공식 wrapper + 키움 가이드 검증.
 *
 * 주문:
 *  - kt10000: 매수주문
 *  - kt10001: 매도주문
 *  - kt10002: 정정주문
 *  - kt10003: 취소주문
 *
 * 계좌:
 *  - kt00018: 계좌평가잔고내역요청 (positions + 평가금액)
 *  - kt00001: 예수금상세현황요청 (deposit / d2)
 *  - kt00004: 계좌평가현황요청 (totalEval 보강)
 *  - ka10075: 미체결요청
 *  - ka10076: 체결요청
 *
 * 시세:
 *  - ka10004: 주식호가요청 (10단계 호가)
 *  - ka10006: 주식현재가요청
 *
 * 차트:
 *  - ka10081: 일봉
 *  - ka10082: 주봉
 *  - ka10083: 월봉
 *
 * 거래일: Kiwoom 미제공 → shared/market-rules KRX 휴장일 폴백.
 */
export const KIWOOM_API_ID = {
  ORDER_BUY: 'kt10000',
  ORDER_SELL: 'kt10001',
  ORDER_MODIFY: 'kt10002',
  ORDER_CANCEL: 'kt10003',
  BALANCE_EVALUATION: 'kt00018',
  DEPOSIT_DETAIL: 'kt00001',
  ACCOUNT_EVALUATION: 'kt00004',
  UNFILLED_ORDERS: 'ka10075',
  FILLED_ORDERS: 'ka10076',
  STOCK_QUOTE: 'ka10004',
  STOCK_PRICE: 'ka10006',
  CHART_DAILY: 'ka10081',
  CHART_WEEKLY: 'ka10082',
  CHART_MONTHLY: 'ka10083',
} as const;

/** WebSocket type 코드 — KiwoomWebSocketServiceName 검증. */
export const KIWOOM_WS_TYPE = {
  /** 주문체결 (체결통보). */
  EXEC_NOTICE: '00',
  /** 잔고 변경. */
  BALANCE: '04',
  /** 주식체결 (tick). */
  TICK: '0B',
  /** 주식호가잔량 (orderbook). */
  ORDERBOOK: '0D',
} as const;

/** Kiwoom 거래소 구분 (dmst_stex_tp). */
export const KIWOOM_EXCHANGE = {
  KRX: '1',
  NXT: '2',
  SOR: '3',
} as const;

/** Kiwoom 주문 구분 (trde_tp). */
export const KIWOOM_ORDER_TYPE = {
  /** 보통 (지정가). */
  LIMIT: '0',
  /** 시장가. */
  MARKET: '3',
  /** 조건부지정가. */
  CONDITIONAL_LIMIT: '5',
} as const;

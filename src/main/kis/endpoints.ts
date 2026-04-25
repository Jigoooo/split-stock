import type { AppEnv } from '@shared/contracts';

/**
 * KIS Developers API 엔드포인트 정의.
 * 실전/모의 base URL이 다르며, 일부 TR_ID도 분기.
 *
 * 출처:
 * - REST: https://apiportal.koreainvestment.com/intro
 * - WebSocket: https://apiportal.koreainvestment.com/apiservice/apiservice-tryitout
 */

export const KIS_BASE_URL = {
  PROD: 'https://openapi.koreainvestment.com:9443',
  MOCK: 'https://openapivts.koreainvestment.com:29443',
} as const;

export const KIS_WS_URL = {
  PROD: 'ws://ops.koreainvestment.com:21000',
  MOCK: 'ws://ops.koreainvestment.com:31000',
} as const;

// compile-time check: 두 상수가 AppEnv 전체를 커버하는지
const _baseCheck: Record<AppEnv, string> = KIS_BASE_URL;
const _wsCheck: Record<AppEnv, string> = KIS_WS_URL;
void _baseCheck;
void _wsCheck;

/**
 * REST 엔드포인트 경로 (base URL 뒤에 이어붙임).
 */
export const KIS_PATH = {
  TOKEN_ISSUE: '/oauth2/tokenP',
  TOKEN_REVOKE: '/oauth2/revokeP',
  APPROVAL_KEY: '/oauth2/Approval',
  INQUIRE_BALANCE: '/uapi/domestic-stock/v1/trading/inquire-balance',
  INQUIRE_PRICE: '/uapi/domestic-stock/v1/quotations/inquire-price',
  INQUIRE_ASKING_PRICE: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
  INQUIRE_CCNL: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
  CHECK_HOLIDAY: '/uapi/domestic-stock/v1/quotations/chk-holiday',
  ORDER_CASH: '/uapi/domestic-stock/v1/trading/order-cash',
  ORDER_CANCEL_REVISE: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
  INQUIRE_DAILY_CHART: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
} as const;

/**
 * 국내주식 주요 TR_ID — 실전/모의 분기 대응.
 * KIS Open API 공식 문서 기준 (2026-04).
 */
export type TrIdKey = 'BALANCE' | 'BUY_CASH' | 'SELL_CASH' | 'CANCEL_REVISE' | 'INQUIRE_CCNL';

export const TR_ID: Record<TrIdKey, Record<AppEnv, string>> = {
  BALANCE: { PROD: 'TTTC8434R', MOCK: 'VTTC8434R' },
  BUY_CASH: { PROD: 'TTTC0012U', MOCK: 'VTTC0012U' },
  SELL_CASH: { PROD: 'TTTC0011U', MOCK: 'VTTC0011U' },
  CANCEL_REVISE: { PROD: 'TTTC0013U', MOCK: 'VTTC0013U' },
  INQUIRE_CCNL: { PROD: 'TTTC8001R', MOCK: 'VTTC8001R' },
};

export function trId(key: TrIdKey, env: AppEnv): string {
  const row = TR_ID[key];
  const value = row[env];
  if (!value) {
    throw new Error(`TR_ID missing for key=${key} env=${env}`);
  }
  return value;
}

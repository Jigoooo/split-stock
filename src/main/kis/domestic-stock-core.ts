import type { AppEnv } from '@shared/contracts';
import type { KisHttpClient } from './http-client';

export interface DomesticStockDeps {
  http: KisHttpClient;
  env: AppEnv;
  token: string;
  appKey: string;
  appSecret: string;
  accountNo8: string;
  accountProdCd: string;
}

export type DomesticStockQueryDeps = Omit<DomesticStockDeps, 'accountNo8' | 'accountProdCd'>;

export function authHeaders(
  deps: Pick<DomesticStockDeps, 'token' | 'appKey' | 'appSecret'>,
  trIdValue: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: trIdValue,
    custtype: 'P',
  };
}

export function parseNum(x: string | undefined): number {
  if (!x) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function resolveDailyCcldTrId(
  env: AppEnv,
  period: 'before' | 'inner',
): 'CTSC9215R' | 'TTTC0081R' | 'VTSC9215R' | 'VTTC0081R' {
  if (period === 'before') {
    return env === 'PROD' ? 'CTSC9215R' : 'VTSC9215R';
  }
  return env === 'PROD' ? 'TTTC0081R' : 'VTTC0081R';
}

export function toIsoDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function hhmmssNow(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

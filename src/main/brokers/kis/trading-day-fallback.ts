import type { AppEnv, KisError } from '@shared/contracts';

export function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function shouldFallbackKisMockTradingDayToLocal(env: AppEnv, error: KisError): boolean {
  if (env !== 'MOCK' || error.kind !== 'API_BUSINESS') return false;
  return /해당\s*서비스를\s*찾을\s*수?\s*없습니다|service\s*not\s*found/i.test(error.msg);
}

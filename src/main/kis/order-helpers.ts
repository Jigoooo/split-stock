import type { OrderDeps } from './order';

export function orderAuthHeaders(deps: OrderDeps, trIdValue: string): Record<string, string> {
  return {
    authorization: `Bearer ${deps.token}`,
    appkey: deps.appKey,
    appsecret: deps.appSecret,
    tr_id: trIdValue,
    custtype: 'P',
  };
}

export function divisionCode(division: 'LIMIT' | 'MARKET'): '00' | '01' {
  return division === 'MARKET' ? '01' : '00';
}

export function priceString(price: number, division: 'LIMIT' | 'MARKET'): string {
  return division === 'MARKET' ? '0' : String(price);
}

export function shouldRetryRateLimitedOrder(deps: OrderDeps): boolean {
  return deps.env === 'MOCK';
}

export function getRateLimitRetryDelayMs(deps: OrderDeps): number {
  return deps.rateLimitRetryDelayMs ?? 1100;
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

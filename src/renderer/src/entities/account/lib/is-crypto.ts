import { isCryptoBroker, isDomesticBroker } from '@shared/contracts';

/**
 * 활성 계좌가 코인(crypto) 거래소 계좌인지 판별.
 *
 * 곳곳에 산재하던 `account?.broker === 'UPBIT'` 분기를 단일 helper 로 추상화.
 * null/undefined 안전 — 계좌 미선택 상태에서 false 반환.
 */
export function isCryptoAccount(account: { broker?: string | null } | null | undefined): boolean {
  return account != null && isCryptoBroker(account.broker);
}

/** 활성 계좌가 국내주식 broker 계좌인지 판별. */
export function isDomesticAccount(account: { broker?: string | null } | null | undefined): boolean {
  return account != null && isDomesticBroker(account.broker);
}

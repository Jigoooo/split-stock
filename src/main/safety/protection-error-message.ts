import type { ProtectionGuardError } from './protection-guard';

/**
 * ProtectionGuardError 를 사용자에게 노출할 한국어 메시지로 변환.
 * auto-buy-guard / crypto-auto-buy-guard 양쪽에서 공유.
 */
export function protectionErrorMessage(error: ProtectionGuardError): string {
  switch (error.kind) {
    case 'LIMIT_PER_SYMBOL_DAILY_BUYS':
      return `자동매수 차단: 종목별 1일 최대 매수 횟수(${error.max}회)에 도달했습니다.`;
    case 'LIMIT_DAILY_TOTAL_COUNT':
      return `자동매수 차단: 1일 총 최대 매수 건수(${error.max}회)에 도달했습니다.`;
    case 'LIMIT_DAILY_TOTAL_AMOUNT':
      return `자동매수 차단: 1일 총 최대 매수 금액(${error.maxKrw.toLocaleString('ko-KR')}원)을 초과합니다.`;
    case 'LIMIT_ACCOUNT_TOTAL_AMOUNT':
      return `자동매수 차단: 계좌 총 최대 매수 금액(${error.maxKrw.toLocaleString('ko-KR')}원)을 초과합니다.`;
    case 'DB_ERROR':
      return '자동매수 차단: 보호 한도 확인 중 오류가 발생했습니다.';
  }
}

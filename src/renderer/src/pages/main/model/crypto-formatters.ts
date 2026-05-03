import { formatCryptoPrice } from './crypto-format';

/**
 * 코인 메인 화면 전용 표시 헬퍼.
 * crypto-main-page.tsx 모놀리식 분해의 1단계로 추출. (RALPLAN P5)
 */

export function formatSignedPrice(value: string | undefined, market: string): string {
  if (!value) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${formatCryptoPrice(Math.abs(numeric), market)}`;
}

export function formatPercent(value: string | undefined): string {
  if (!value) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${(numeric * 100).toFixed(2)}%`;
}

export function formatTradeTime(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function isOpenOrder(state: string): boolean {
  return state === 'wait' || state === 'watch';
}

export function stateLabel(state: string): string {
  if (state === 'wait') return '대기';
  if (state === 'watch') return '예약';
  if (state === 'done') return '완료';
  if (state === 'cancel') return '취소';
  return state;
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

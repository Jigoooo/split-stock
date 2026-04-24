import { thousandSeparator } from '@renderer/shared/lib/formatter';

export function stageNumbers(count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n += 1) out.push(n);
  return out;
}

export function shouldRenderInlineBalanceError(
  message: string | null,
  rowCount: number,
  summary: {
    deposit: number;
    d2Deposit: number;
    totalBuyAmount: number;
    totalEval: number;
    estimatedAsset: number;
  },
): boolean {
  if (!message) return false;
  const hasSnapshot =
    rowCount > 0 ||
    summary.deposit > 0 ||
    summary.d2Deposit > 0 ||
    summary.totalBuyAmount > 0 ||
    summary.totalEval > 0 ||
    summary.estimatedAsset > 0;
  if (!hasSnapshot) return true;

  return !isTransientBalanceError(message);
}

export function describeMismatchReason(reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH'): string {
  switch (reason) {
    case 'NO_LOTS':
      return '잔고는 있는데 차수 장부가 없음';
    case 'STALE_LOTS':
      return '차수 장부만 남아 있음';
    case 'QTY_MISMATCH':
      return '수량 불일치';
  }
}

export function formatKrw(value: number): string {
  return thousandSeparator(Math.round(value));
}

export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${thousandSeparator(Math.round(value))}`;
}

export function numberClassName(value: number): string | undefined {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}

function isTransientBalanceError(message: string): boolean {
  return (
    message.startsWith('잔고조회 요청이 너무 많습니다.') ||
    message.startsWith('잔고 서버에 일시적인 문제가 있습니다.')
  );
}

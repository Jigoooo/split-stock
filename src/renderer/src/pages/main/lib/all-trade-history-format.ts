export function formatNumber(value: number): string {
  return value === 0 ? '0' : formatSigned(value).replace(/^\+/, '');
}

export function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.round(Math.abs(value)).toLocaleString('ko-KR')}`;
}

export function numberClassName(value: number): string {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}

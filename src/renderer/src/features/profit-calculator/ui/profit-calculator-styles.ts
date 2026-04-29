export type ProfitTone = 'up' | 'down' | 'flat';

export function profitTone(value: number): ProfitTone {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

export function profitToneClass(value: number): string {
  return `profit-calculator__tone--${profitTone(value)}`;
}

export function profitKpiTone(value: number): 'default' | 'up' | 'down' {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'default';
}

export function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString()}원`;
}

export function formatSignedKrw(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.round(Math.abs(value)).toLocaleString()}원`;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

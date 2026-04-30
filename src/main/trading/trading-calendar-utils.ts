import type { TradingDayConfidence, TradingDaySource } from '@shared/contracts';

export function normalizeTradingCalendarDate(input: string | Date): string | null {
  if (input instanceof Date) return yyyymmdd(input);
  const digits = input.trim().replaceAll('-', '').replaceAll('.', '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

export function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function normalizeTradingDaySource(source: string): TradingDaySource {
  return source === 'KRX_DOWNLOAD' || source === 'MANUAL_IMPORT' || source === 'BUNDLED'
    ? source
    : 'UNKNOWN';
}

export function confidenceForTradingDaySource(source: TradingDaySource): TradingDayConfidence {
  if (source === 'KRX_DOWNLOAD' || source === 'MANUAL_IMPORT') return 'HIGH';
  if (source === 'BUNDLED') return 'MEDIUM';
  return 'LOW';
}

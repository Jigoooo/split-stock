import { format, isValid } from 'date-fns';

export type DateTimeInput = Date | number | string | null | undefined;

const DATE_PATTERN = 'yyyy.MM.dd';
const TIME_PATTERN = 'HH:mm:ss';
const DATE_TIME_PATTERN = `${DATE_PATTERN} ${TIME_PATTERN}`;
const DATE_TIME_LONG_KO_PATTERN = 'yyyy년 M월 d일 H시 m분 s초';

function toDate(value: DateTimeInput): Date | null {
  if (value === null || value === undefined || value === 0) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '0') return null;
    const parsed = /^\d+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);
    return isValid(parsed) ? parsed : null;
  }
  const parsed = new Date(value);
  return isValid(parsed) ? parsed : null;
}

function formatDateTimeValue(value: DateTimeInput, pattern: string): string {
  const date = toDate(value);
  if (!date) return '-';
  return format(date, pattern);
}

export function formatDateOnly(value: DateTimeInput): string {
  return formatDateTimeValue(value, DATE_PATTERN);
}

export function formatTimeOnly(value: DateTimeInput): string {
  return formatDateTimeValue(value, TIME_PATTERN);
}

export function formatDateTime(value: DateTimeInput): string {
  return formatDateTimeValue(value, DATE_TIME_PATTERN);
}

export function formatDateTimeLongKo(value: DateTimeInput): string {
  return formatDateTimeValue(value, DATE_TIME_LONG_KO_PATTERN);
}

import { endOfDay, format, isAfter, isBefore, isValid, parse, startOfDay } from 'date-fns';
import type { DatePickerMode } from '../model/types';
import { getDefaultDateFormat } from './get-default-date-format';

const FALLBACK_FORMATS = ['yyyy-MM-dd', 'yyyy-MM', 'yyyy'];

function normalizeParsedDate(date: Date, formatString: string) {
  if (formatString === 'yyyy') {
    return startOfDay(new Date(date.getFullYear(), 0, 1));
  }

  if (formatString === 'yyyy-MM') {
    return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  return startOfDay(date);
}

export function parsePickerDate(
  value: string | undefined,
  mode: DatePickerMode,
  dateFormat?: string,
) {
  if (!value) return null;

  const formats = Array.from(
    new Set(
      [dateFormat, getDefaultDateFormat(mode, dateFormat), ...FALLBACK_FORMATS].filter(Boolean),
    ),
  ) as string[];

  for (const formatString of formats) {
    const parsed = parse(value, formatString, new Date());
    if (!isValid(parsed)) continue;

    const normalized = normalizeParsedDate(parsed, formatString);
    if (format(normalized, formatString) === value) {
      return normalized;
    }
  }

  return null;
}

export function formatPickerDate(date: Date, mode: DatePickerMode, dateFormat?: string) {
  return format(date, getDefaultDateFormat(mode, dateFormat));
}

export function clampDate(date: Date, minDate: Date | null, maxDate: Date | null) {
  if (minDate && isBefore(startOfDay(date), startOfDay(minDate))) {
    return startOfDay(minDate);
  }

  if (maxDate && isAfter(startOfDay(date), endOfDay(maxDate))) {
    return startOfDay(maxDate);
  }

  return startOfDay(date);
}

export function isDateDisabled(date: Date, minDate: Date | null, maxDate: Date | null) {
  if (minDate && isBefore(startOfDay(date), startOfDay(minDate))) {
    return true;
  }

  if (maxDate && isAfter(startOfDay(date), endOfDay(maxDate))) {
    return true;
  }

  return false;
}

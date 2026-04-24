import type { ChangeEvent, RefObject } from 'react';
import type { CalendarDateParts, DateDraftParts, DateSegmentName } from '../model/types';

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
export const DATE_SEGMENT_ORDER = [
  'year',
  'month',
  'day',
] as const satisfies ReadonlyArray<DateSegmentName>;
export const YEAR_PAGE_SIZE = 12;
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, monthIndex) => monthIndex);
export const DATE_SEGMENT_LENGTH: Record<DateSegmentName, number> = {
  day: 2,
  month: 2,
  year: 4,
};
export const DATE_SEGMENT_PLACEHOLDER: Record<DateSegmentName, string> = {
  day: 'DD',
  month: 'MM',
  year: 'YYYY',
};
export const DATE_SEGMENT_SUFFIX: Record<DateSegmentName, string> = {
  day: '일',
  month: '월',
  year: '연도',
};

export function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function emptyDraftParts(): DateDraftParts {
  return {
    day: '',
    month: '',
    year: '',
  };
}

export function toIsoDate(parts: CalendarDateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function parseCanonicalIso(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;

  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;

  return { day, month, year };
}

export function parseRecoverableDraft(value: string): CalendarDateParts | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (/^\d{8}$/.test(digitsOnly)) {
    return {
      day: Number(digitsOnly.slice(6, 8)),
      month: Number(digitsOnly.slice(4, 6)),
      year: Number(digitsOnly.slice(0, 4)),
    };
  }

  const compactMatch = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/.exec(trimmed);
  if (!compactMatch) return null;

  return {
    day: Number(compactMatch[3]),
    month: Number(compactMatch[2]),
    year: Number(compactMatch[1]),
  };
}

export function clampPartsToValidDate(parts: CalendarDateParts): CalendarDateParts {
  const month = Math.min(12, Math.max(1, parts.month));
  const day = Math.min(getDaysInMonth(parts.year, month), Math.max(1, parts.day));
  return {
    day,
    month,
    year: parts.year,
  };
}

export function clampIsoToBounds(value: string, min?: string, max?: string): string {
  let next = value;
  if (min && next < min) {
    next = min;
  }
  if (max && next > max) {
    next = max;
  }
  return next;
}

export function normalizeDraftValue(
  draft: string,
  committedValue: string,
  min?: string,
  max?: string,
): string {
  const trimmed = draft.trim();
  if (trimmed === '') return '';

  const recoverable = parseRecoverableDraft(trimmed);
  if (!recoverable) {
    return committedValue;
  }

  return clampIsoToBounds(toIsoDate(clampPartsToValidDate(recoverable)), min, max);
}

export function sanitizeSegmentDraft(value: string, segment: DateSegmentName): string {
  return value.replace(/\D/g, '').slice(0, DATE_SEGMENT_LENGTH[segment]);
}

export function toDraftParts(value: string): DateDraftParts {
  const trimmed = value.trim();
  if (trimmed === '') return emptyDraftParts();

  const canonical = parseCanonicalIso(trimmed);
  if (canonical) {
    return {
      day: pad2(canonical.day),
      month: pad2(canonical.month),
      year: String(canonical.year).padStart(4, '0'),
    };
  }

  const recoverable = parseRecoverableDraft(trimmed);
  if (!recoverable) return emptyDraftParts();

  return {
    day: sanitizeSegmentDraft(String(recoverable.day), 'day'),
    month: sanitizeSegmentDraft(String(recoverable.month), 'month'),
    year: sanitizeSegmentDraft(String(recoverable.year), 'year'),
  };
}

export function normalizeDraftParts(
  draftParts: DateDraftParts,
  committedValue: string,
  min?: string,
  max?: string,
): string {
  if (
    draftParts.year.trim() === '' &&
    draftParts.month.trim() === '' &&
    draftParts.day.trim() === ''
  ) {
    return '';
  }

  return normalizeDraftValue(
    `${draftParts.year}-${draftParts.month}-${draftParts.day}`,
    committedValue,
    min,
    max,
  );
}

export function hasDraftPartsValue(draftParts: DateDraftParts): boolean {
  return (
    draftParts.year.trim() !== '' || draftParts.month.trim() !== '' || draftParts.day.trim() !== ''
  );
}

export function getAdjacentSegment(
  segment: DateSegmentName,
  offset: -1 | 1,
): DateSegmentName | null {
  const nextIndex = DATE_SEGMENT_ORDER.indexOf(segment) + offset;
  return DATE_SEGMENT_ORDER[nextIndex] ?? null;
}

export function createSegmentLabel(label: string | undefined, segment: DateSegmentName): string {
  const suffix = DATE_SEGMENT_SUFFIX[segment];
  return label ? `${label} ${suffix}` : suffix;
}

export function findSegmentFromTarget(
  target: EventTarget | null,
  inputRefs: Record<DateSegmentName, RefObject<HTMLInputElement | null>>,
): DateSegmentName | null {
  return DATE_SEGMENT_ORDER.find((segment) => inputRefs[segment].current === target) ?? null;
}

export function toCalendarMonth(value: string): Date {
  const parts = parseCanonicalIso(value);
  if (parts) {
    return new Date(parts.year, parts.month - 1, 1);
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function getYearPageStart(year: number): number {
  return Math.floor(year / 12) * 12;
}

export function canSelectRange(
  startIso: string,
  endIso: string,
  min?: string,
  max?: string,
): boolean {
  if (min !== undefined && endIso < min) return false;
  if (max !== undefined && startIso > max) return false;
  return true;
}

export function canSelectMonth(
  year: number,
  monthIndex: number,
  min?: string,
  max?: string,
): boolean {
  const month = monthIndex + 1;
  return canSelectRange(
    toIsoDate({ day: 1, month, year }),
    toIsoDate({ day: getDaysInMonth(year, month), month, year }),
    min,
    max,
  );
}

export function canSelectYear(year: number, min?: string, max?: string): boolean {
  return canSelectRange(
    toIsoDate({ day: 1, month: 1, year }),
    toIsoDate({ day: 31, month: 12, year }),
    min,
    max,
  );
}

export function canSelectYearPage(yearPageStart: number, min?: string, max?: string): boolean {
  return Array.from({ length: YEAR_PAGE_SIZE }, (_, index) => yearPageStart + index).some((year) =>
    canSelectYear(year, min, max),
  );
}

export interface CalendarDayCell {
  dayLabel: number;
  inCurrentMonth: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  isToday: boolean;
  iso: string;
}

export function buildCalendarDays(
  visibleMonth: Date,
): Array<{ dayLabel: number; inCurrentMonth: boolean; iso: string }> {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const days: Array<{ dayLabel: number; inCurrentMonth: boolean; iso: string }> = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, index - firstWeekday + 1);
    days.push({
      dayLabel: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
      iso: toIsoDate({
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      }),
    });
  }

  return days;
}

export function getTodayIso(now: Date = new Date()): string {
  return toIsoDate({
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
}

export function isFocusableTarget(
  node: Node | null,
  ...containers: Array<HTMLElement | null>
): boolean {
  return containers.some((container) => container?.contains(node ?? null));
}

export function createSyntheticDateChangeEvent(
  nextValue: string,
  name: string | undefined,
): ChangeEvent<HTMLInputElement> {
  const target = {
    name,
    value: nextValue,
  };

  return {
    bubbles: true,
    cancelable: false,
    currentTarget: target,
    defaultPrevented: false,
    eventPhase: 3,
    isTrusted: false,
    nativeEvent: new Event('change'),
    persist: () => undefined,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    target,
    timeStamp: Date.now(),
    type: 'change',
  } as unknown as ChangeEvent<HTMLInputElement>;
}

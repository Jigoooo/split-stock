import { KRX_REGULAR_CLOSE_MINUTE, KRX_REGULAR_OPEN_MINUTE } from '@shared/market-rules';
import { normalizeTradingCalendarDate, yyyymmdd } from './trading-calendar-utils';

export class TradingCalendarImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingCalendarImportError';
  }
}

interface ParsedCalendarRow {
  date: string;
  openDay?: boolean;
  openMinute?: number | null;
  closeMinute?: number | null;
  reason?: string;
}

export interface NormalizedImportedCalendarDay {
  date: string;
  openDay: boolean;
  openMinute: number | null;
  closeMinute: number | null;
  reason: string;
}

export function parseCalendarImport(content: string): ParsedCalendarRow[] {
  const trimmed = content.trim();
  if (!trimmed) throw new TradingCalendarImportError('빈 캘린더 파일입니다.');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonCalendar(trimmed);
  }
  return parseDelimitedCalendar(trimmed);
}

export function normalizeImportedDays(
  rows: ParsedCalendarRow[],
  sourceVersion: string,
): NormalizedImportedCalendarDay[] {
  if (rows.length === 0) throw new TradingCalendarImportError('캘린더 행이 없습니다.');
  const hasExplicitOpenDay = rows.some((row) => row.openDay !== undefined);
  if (hasExplicitOpenDay) {
    return rows.map((row) => {
      if (row.openDay === undefined) {
        throw new TradingCalendarImportError('openDay가 있는 행과 없는 행을 섞을 수 없습니다.');
      }
      return {
        date: row.date,
        openDay: row.openDay,
        openMinute: row.openDay ? (row.openMinute ?? KRX_REGULAR_OPEN_MINUTE) : null,
        closeMinute: row.openDay ? (row.closeMinute ?? KRX_REGULAR_CLOSE_MINUTE) : null,
        reason: row.reason ?? (row.openDay ? 'REGULAR' : 'MARKET_CLOSING'),
      };
    });
  }

  const holidayByDate = new Map(rows.map((row) => [row.date, row.reason ?? 'MARKET_CLOSING']));
  const years = new Set(rows.map((row) => Number(row.date.slice(0, 4))));
  const days: NormalizedImportedCalendarDay[] = [];
  for (const year of years) {
    const cursor = new Date(year, 0, 1);
    while (cursor.getFullYear() === year) {
      const date = yyyymmdd(cursor);
      const holidayReason = holidayByDate.get(date);
      const day = cursor.getDay();
      const openDay = day !== 0 && day !== 6 && holidayReason === undefined;
      days.push({
        date,
        openDay,
        openMinute: openDay ? KRX_REGULAR_OPEN_MINUTE : null,
        closeMinute: openDay ? KRX_REGULAR_CLOSE_MINUTE : null,
        reason: holidayReason ?? (day === 0 || day === 6 ? 'WEEKEND' : 'REGULAR'),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  if (days.length === 0) {
    throw new TradingCalendarImportError(
      `캘린더 범위를 만들 수 없습니다. version=${sourceVersion}`,
    );
  }
  return days;
}

function parseJsonCalendar(content: string): ParsedCalendarRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new TradingCalendarImportError('JSON 캘린더 파싱에 실패했습니다.');
  }
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { days?: unknown }).days)
      ? (raw as { days: unknown[] }).days
      : null;
  if (!rows)
    throw new TradingCalendarImportError('JSON 캘린더는 배열 또는 {days: []} 형식이어야 합니다.');
  return rows.map((row, index) => parseObjectCalendarRow(row, index));
}

function parseObjectCalendarRow(row: unknown, index: number): ParsedCalendarRow {
  if (typeof row !== 'object' || row === null) {
    throw new TradingCalendarImportError(`${index + 1}번째 캘린더 행이 객체가 아닙니다.`);
  }
  const record = row as Record<string, unknown>;
  const date = normalizeTradingCalendarDate(
    String(record.date ?? record.baseDate ?? record.tradingDate ?? ''),
  );
  if (!date)
    throw new TradingCalendarImportError(`${index + 1}번째 캘린더 행의 날짜가 잘못됐습니다.`);
  const openDay = parseOptionalOpenDay(record.openDay ?? record.open ?? record.isOpen);
  const openMinute = parseOptionalMinute(record.openMinute);
  const closeMinute = parseOptionalMinute(record.closeMinute);
  const reason = String(record.reason ?? record.name ?? record.holidayName ?? '').trim();
  return {
    date,
    ...(openDay !== undefined && { openDay }),
    ...(openMinute !== undefined && { openMinute }),
    ...(closeMinute !== undefined && { closeMinute }),
    ...(reason !== '' && { reason }),
  };
}

function parseDelimitedCalendar(content: string): ParsedCalendarRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new TradingCalendarImportError('CSV 캘린더는 헤더와 최소 1개 행이 필요합니다.');
  }
  const delimiter = lines[0]?.includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0] ?? '', delimiter).map((h) => normalizeHeader(h));
  const dateIdx = headers.findIndex((h) =>
    ['date', 'basedate', 'tradingdate', '일자', '날짜'].includes(h),
  );
  if (dateIdx < 0) throw new TradingCalendarImportError('CSV 캘린더에 date 컬럼이 없습니다.');
  const openIdx = headers.findIndex((h) =>
    ['openday', 'open', 'isopen', '개장여부', '거래일'].includes(h),
  );
  const openMinuteIdx = headers.findIndex((h) => ['openminute', 'openmin', '개장분'].includes(h));
  const closeMinuteIdx = headers.findIndex((h) =>
    ['closeminute', 'closemin', '폐장분'].includes(h),
  );
  const reasonIdx = headers.findIndex((h) =>
    ['reason', 'name', 'holidayname', '휴장사유', '사유'].includes(h),
  );

  return lines.slice(1).map((line, index) => {
    const cells = splitLine(line, delimiter);
    const date = normalizeTradingCalendarDate(cells[dateIdx] ?? '');
    if (!date)
      throw new TradingCalendarImportError(`${index + 2}번째 캘린더 행의 날짜가 잘못됐습니다.`);
    const openDay = openIdx >= 0 ? parseOptionalOpenDay(cells[openIdx]) : undefined;
    const openMinute = openMinuteIdx >= 0 ? parseOptionalMinute(cells[openMinuteIdx]) : undefined;
    const closeMinute =
      closeMinuteIdx >= 0 ? parseOptionalMinute(cells[closeMinuteIdx]) : undefined;
    const reason = reasonIdx >= 0 ? cells[reasonIdx]?.trim() : undefined;
    return {
      date,
      ...(openDay !== undefined && { openDay }),
      ...(openMinute !== undefined && { openMinute }),
      ...(closeMinute !== undefined && { closeMinute }),
      ...(reason !== undefined && reason !== '' && { reason }),
    };
  });
}

function parseOptionalOpenDay(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'y', 'yes', 'open', '개장', '거래일'].includes(normalized)) return true;
  if (['0', 'false', 'n', 'no', 'closed', '휴장', '휴장일'].includes(normalized)) return false;
  throw new TradingCalendarImportError(`openDay 값을 해석할 수 없습니다: ${String(value)}`);
}

function parseOptionalMinute(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1439) {
    throw new TradingCalendarImportError(`분 값은 0~1439 정수여야 합니다: ${String(value)}`);
  }
  return n;
}

function normalizeHeader(header: string): string {
  return header.trim().replaceAll(/\s|_/g, '').toLowerCase();
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

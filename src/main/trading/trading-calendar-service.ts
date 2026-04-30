import type { TradingDayConfidence, TradingDaySource, TradingDayVerdict } from '@shared/contracts';
import {
  KRX_REGULAR_CLOSE_MINUTE,
  KRX_REGULAR_OPEN_MINUTE,
  listBundledKrxCalendarDays,
  resolveBundledKrxTradingDay,
} from '@shared/market-rules';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tradingCalendarDays } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';

type CalendarRow = typeof tradingCalendarDays.$inferSelect;

export interface TradingCalendarServiceOptions {
  db: Db;
  logger: EventLogger;
  now?: () => Date;
}

export interface TradingCalendarRefreshResult {
  source: TradingDaySource;
  insertedOrUpdated: number;
  coverage: TradingCalendarStatus['coverage'];
}

export interface TradingCalendarStatus {
  coverage: {
    minDate: string | null;
    maxDate: string | null;
    bySource: Record<string, number>;
  };
  currentSourceVersion: string | null;
  rowCount: number;
  checkedAt: number;
}

export class TradingCalendarImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingCalendarImportError';
  }
}

/**
 * KIS/Kiwoom 공통 KRX 거래 캘린더.
 *
 * 최종 주문 가능 여부는 이 서비스의 verdict 만 사용한다. broker별 휴장일 API는
 * 불일치 감지와 감사 로그에만 사용해야 한다.
 */
export class TradingCalendarService {
  private readonly db: Db;
  private readonly logger: EventLogger;
  private readonly now: () => Date;

  constructor(opts: TradingCalendarServiceOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.now = opts.now ?? (() => new Date());
  }

  getTradingDayStatus(date: Date | string): TradingDayVerdict {
    const yyyymmdd = normalizeDate(date);
    if (yyyymmdd === null) {
      return this.unknownVerdict('INVALID_DATE', typeof date === 'string' ? date : '');
    }

    const row = this.db
      .select()
      .from(tradingCalendarDays)
      .where(eq(tradingCalendarDays.date, yyyymmdd))
      .get();
    if (row) return this.verdictFromRow(row);

    const bundled = resolveBundledKrxTradingDay(yyyymmdd);
    if (bundled) {
      this.upsertDay({
        date: bundled.date,
        openDay: bundled.openDay,
        openMinute: bundled.openMinute,
        closeMinute: bundled.closeMinute,
        reason: bundled.reason,
        source: 'BUNDLED',
        sourceVersion: bundled.sourceVersion,
      });
      return this.verdictFromRow({
        date: bundled.date,
        openDay: bundled.openDay,
        openMinute: bundled.openMinute,
        closeMinute: bundled.closeMinute,
        reason: bundled.reason,
        source: 'BUNDLED',
        sourceVersion: bundled.sourceVersion,
        updatedAt: this.now(),
      });
    }

    return this.unknownVerdict('CALENDAR_MISSING', yyyymmdd);
  }

  refreshTradingCalendar(): TradingCalendarRefreshResult {
    const insertedOrUpdated = this.seedBundled();
    const status = this.getStatus();
    return { source: 'BUNDLED', insertedOrUpdated, coverage: status.coverage };
  }

  seedBundled(): number {
    let changed = 0;
    const days = listBundledKrxCalendarDays();
    const existing = new Map(
      this.db
        .select()
        .from(tradingCalendarDays)
        .all()
        .map((row) => [row.date, row]),
    );
    this.db.transaction((tx) => {
      for (const day of days) {
        const row = existing.get(day.date);
        if (row && (row.source === 'KRX_DOWNLOAD' || row.source === 'MANUAL_IMPORT')) continue;
        if (
          row &&
          row.source === 'BUNDLED' &&
          row.sourceVersion === day.sourceVersion &&
          row.openDay === day.openDay &&
          row.openMinute === day.openMinute &&
          row.closeMinute === day.closeMinute &&
          row.reason === day.reason
        ) {
          continue;
        }
        tx.insert(tradingCalendarDays)
          .values({
            date: day.date,
            openDay: day.openDay,
            openMinute: day.openMinute,
            closeMinute: day.closeMinute,
            reason: day.reason,
            source: 'BUNDLED',
            sourceVersion: day.sourceVersion,
            updatedAt: this.now(),
          })
          .onConflictDoUpdate({
            target: tradingCalendarDays.date,
            set: {
              openDay: day.openDay,
              openMinute: day.openMinute,
              closeMinute: day.closeMinute,
              reason: day.reason,
              source: 'BUNDLED',
              sourceVersion: day.sourceVersion,
              updatedAt: this.now(),
            },
          })
          .run();
        changed += 1;
      }
    });
    this.logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'trading-calendar.seed-bundled',
      payload: { changed, source: 'BUNDLED' },
    });
    return changed;
  }

  importTradingCalendar(input: {
    content: string;
    source?: Exclude<TradingDaySource, 'UNKNOWN' | 'BUNDLED'>;
    sourceVersion?: string;
  }): TradingCalendarRefreshResult {
    const source = input.source ?? 'MANUAL_IMPORT';
    const sourceVersion = input.sourceVersion?.trim() || `${source.toLowerCase()}-${Date.now()}`;
    const parsed = parseCalendarImport(input.content);
    const days = normalizeImportedDays(parsed, sourceVersion);

    this.db.transaction((tx) => {
      for (const day of days) {
        tx.insert(tradingCalendarDays)
          .values({
            date: day.date,
            openDay: day.openDay,
            openMinute: day.openMinute,
            closeMinute: day.closeMinute,
            reason: day.reason,
            source,
            sourceVersion,
            updatedAt: this.now(),
          })
          .onConflictDoUpdate({
            target: tradingCalendarDays.date,
            set: {
              openDay: day.openDay,
              openMinute: day.openMinute,
              closeMinute: day.closeMinute,
              reason: day.reason,
              source,
              sourceVersion,
              updatedAt: this.now(),
            },
          })
          .run();
      }
    });

    const status = this.getStatus();
    this.logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'trading-calendar.imported',
      payload: { source, sourceVersion, count: days.length, coverage: status.coverage },
    });
    return { source, insertedOrUpdated: days.length, coverage: status.coverage };
  }

  getStatus(): TradingCalendarStatus {
    const rows = this.db.select().from(tradingCalendarDays).all();
    const bySource: Record<string, number> = {};
    let minDate: string | null = null;
    let maxDate: string | null = null;
    let currentSourceVersion: string | null = null;
    for (const row of rows) {
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
      if (minDate === null || row.date < minDate) minDate = row.date;
      if (maxDate === null || row.date > maxDate) maxDate = row.date;
      if (currentSourceVersion === null && row.sourceVersion !== null) {
        currentSourceVersion = row.sourceVersion;
      }
    }
    return {
      coverage: { minDate, maxDate, bySource },
      currentSourceVersion,
      rowCount: rows.length,
      checkedAt: this.now().getTime(),
    };
  }

  private upsertDay(input: {
    date: string;
    openDay: boolean;
    openMinute: number | null;
    closeMinute: number | null;
    reason: string;
    source: TradingDaySource;
    sourceVersion: string | null;
  }): void {
    this.db
      .insert(tradingCalendarDays)
      .values({ ...input, updatedAt: this.now() })
      .onConflictDoUpdate({
        target: tradingCalendarDays.date,
        set: { ...input, updatedAt: this.now() },
      })
      .run();
  }

  private verdictFromRow(row: CalendarRow): TradingDayVerdict {
    const source = normalizeSource(row.source);
    return {
      date: row.date,
      openDay: row.openDay,
      openMinute: row.openMinute,
      closeMinute: row.closeMinute,
      source,
      sourceVersion: row.sourceVersion,
      reason: row.reason,
      confidence: confidenceForSource(source),
      stale: source === 'UNKNOWN',
      checkedAt: this.now().getTime(),
    };
  }

  private unknownVerdict(reason: string, date: string): TradingDayVerdict {
    return {
      date: /^\d{8}$/.test(date) ? date : yyyymmdd(this.now()),
      openDay: false,
      openMinute: null,
      closeMinute: null,
      source: 'UNKNOWN',
      sourceVersion: null,
      reason,
      confidence: 'LOW',
      stale: true,
      checkedAt: this.now().getTime(),
    };
  }
}

interface ParsedCalendarRow {
  date: string;
  openDay?: boolean;
  openMinute?: number | null;
  closeMinute?: number | null;
  reason?: string;
}

function parseCalendarImport(content: string): ParsedCalendarRow[] {
  const trimmed = content.trim();
  if (!trimmed) throw new TradingCalendarImportError('빈 캘린더 파일입니다.');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonCalendar(trimmed);
  }
  return parseDelimitedCalendar(trimmed);
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
  const date = normalizeDate(String(record.date ?? record.baseDate ?? record.tradingDate ?? ''));
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
    const date = normalizeDate(cells[dateIdx] ?? '');
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

function normalizeImportedDays(
  rows: ParsedCalendarRow[],
  sourceVersion: string,
): Array<{
  date: string;
  openDay: boolean;
  openMinute: number | null;
  closeMinute: number | null;
  reason: string;
}> {
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
  const days: Array<{
    date: string;
    openDay: boolean;
    openMinute: number | null;
    closeMinute: number | null;
    reason: string;
  }> = [];
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

function normalizeDate(input: string | Date): string | null {
  if (input instanceof Date) return yyyymmdd(input);
  const digits = input.trim().replaceAll('-', '').replaceAll('.', '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function normalizeSource(source: string): TradingDaySource {
  return source === 'KRX_DOWNLOAD' || source === 'MANUAL_IMPORT' || source === 'BUNDLED'
    ? source
    : 'UNKNOWN';
}

function confidenceForSource(source: TradingDaySource): TradingDayConfidence {
  if (source === 'KRX_DOWNLOAD' || source === 'MANUAL_IMPORT') return 'HIGH';
  if (source === 'BUNDLED') return 'MEDIUM';
  return 'LOW';
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

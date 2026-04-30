import type { TradingDaySource, TradingDayVerdict } from '@shared/contracts';
import { listBundledKrxCalendarDays, resolveBundledKrxTradingDay } from '@shared/market-rules';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tradingCalendarDays } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';
import { normalizeImportedDays, parseCalendarImport } from './trading-calendar-import';
import {
  confidenceForTradingDaySource,
  normalizeTradingCalendarDate,
  normalizeTradingDaySource,
  yyyymmdd,
} from './trading-calendar-utils';

export { TradingCalendarImportError } from './trading-calendar-import';

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
    const yyyymmdd = normalizeTradingCalendarDate(date);
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
    const source = normalizeTradingDaySource(row.source);
    return {
      date: row.date,
      openDay: row.openDay,
      openMinute: row.openMinute,
      closeMinute: row.closeMinute,
      source,
      sourceVersion: row.sourceVersion,
      reason: row.reason,
      confidence: confidenceForTradingDaySource(source),
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

import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { TradingCalendarImportError, TradingCalendarService } from './trading-calendar-service';

function createService() {
  const db = createTestDb();
  bootstrapSchema(db);
  const logger = { log: vi.fn() };
  return { db, logger, service: new TradingCalendarService({ db, logger }) };
}

describe('TradingCalendarService', () => {
  it('번들 KRX 캘린더를 fallback verdict 로 반환한다', () => {
    const { service } = createService();

    expect(service.getTradingDayStatus('20260430')).toMatchObject({
      date: '20260430',
      openDay: true,
      source: 'BUNDLED',
      stale: false,
    });
  });

  it('holiday-only import 는 해당 연도 전체 캘린더로 확장한다', () => {
    const { service } = createService();

    service.importTradingCalendar({
      content: 'date,reason\n2026-12-31,연말 폐장',
      sourceVersion: 'krx-2026-test',
    });

    expect(service.getTradingDayStatus('20261231')).toMatchObject({
      openDay: false,
      reason: '연말 폐장',
      source: 'MANUAL_IMPORT',
    });
    expect(service.getTradingDayStatus('20261230')).toMatchObject({
      openDay: true,
      source: 'MANUAL_IMPORT',
    });
  });

  it('malformed import 는 reject 한다', () => {
    const { service } = createService();

    expect(() => service.importTradingCalendar({ content: 'reason\n연말 폐장' })).toThrow(
      TradingCalendarImportError,
    );
  });

  it('캘린더 범위 밖 날짜는 UNKNOWN fail-closed verdict 를 반환한다', () => {
    const { service } = createService();

    expect(service.getTradingDayStatus('20270104')).toMatchObject({
      openDay: false,
      source: 'UNKNOWN',
      stale: true,
    });
  });
});

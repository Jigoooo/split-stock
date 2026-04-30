import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { eventLogs } from '../db/schema';
import {
  API_EXTERNAL_FAILED_MESSAGE,
  createApiFailureLogger,
  createEventLogger,
  hashIdentifier,
  logExternalApiFailure,
  maskPayload,
  splitErrorLogger,
} from './event-logger';

describe('maskPayload', () => {
  it('appKey/appSecret/token 필드를 마스킹', () => {
    const out = maskPayload({
      appKey: 'ABCDEFGHIJKLMNOP',
      appSecret: 'shortkey',
      other: 'visible',
    });
    expect(out).toEqual({
      appKey: '************MNOP',
      appSecret: '****tkey',
      other: 'visible',
    });
  });

  it('중첩 객체/배열도 재귀 마스킹', () => {
    const out = maskPayload({
      meta: { token: 'AAAAAAAAAAAAA1234', list: [{ password: 'supersecret' }] },
      ok: 1,
    });
    expect(out).toEqual({
      meta: {
        token: '*************1234',
        list: [{ password: '*******cret' }],
      },
      ok: 1,
    });
    // sanity: '*******cret'은 길이 11
    expect('*******cret').toHaveLength('supersecret'.length);
  });

  it('문자열이 아닌 민감 필드는 그대로 둠', () => {
    const out = maskPayload({ token: 12345, other: null });
    expect(out).toEqual({ token: 12345, other: null });
  });

  it('API 키/서비스키/클라이언트 시크릿 필드를 대소문자 무관하게 마스킹', () => {
    const out = maskPayload({
      apiKey: 'APISECRET123456',
      serviceKey: 'SERVICESECRET123456',
      clientSecret: 'CLIENTSECRET123456',
      'X-Naver-Client-Secret': 'NAVERSECRET123456',
    });
    expect(JSON.stringify(out)).not.toContain('APISECRET');
    expect(JSON.stringify(out)).not.toContain('SERVICESECRET');
    expect(JSON.stringify(out)).not.toContain('CLIENTSECRET');
    expect(JSON.stringify(out)).not.toContain('NAVERSECRET');
    expect(out).toMatchObject({
      apiKey: '***********3456',
      serviceKey: '***************3456',
      clientSecret: '**************3456',
      'X-Naver-Client-Secret': '*************3456',
    });
  });
});

describe('hashIdentifier', () => {
  it('동일 입력 → 동일 해시, 다른 입력 → 다른 해시 (12자리)', () => {
    const a = hashIdentifier('0000123456');
    const b = hashIdentifier('0000123456');
    const c = hashIdentifier('0000123457');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(12);
  });
});

describe('createEventLogger', () => {
  it('event_logs에 row 삽입 + payload는 마스킹된 JSON', () => {
    const db = createTestDb();
    bootstrapSchema(db);
    const logger = createEventLogger(db);

    logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'order.cash.request BUY',
      payload: { appKey: 'SUPERSECRETKEY1234', pdno: '005930' },
    });

    const rows = db.select().from(eventLogs).all();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error('row missing');
    expect(row.level).toBe('INFO');
    expect(row.category).toBe('ORDER');
    expect(row.message).toBe('order.cash.request BUY');
    expect(row.payloadJson).toBeTruthy();
    expect(row.payloadJson).toContain('"pdno":"005930"');
    expect(row.payloadJson).not.toContain('SUPERSECRETKEY1234');
    expect(row.payloadJson).toContain('1234'); // 마지막 4자리 유지
  });
});

describe('createApiFailureLogger', () => {
  it('모든 로그는 primary에 남기고 api.external.failed만 API 실패 파일 sink에 복제', () => {
    const primaryEntries: unknown[] = [];
    const apiEntries: unknown[] = [];
    const logger = createApiFailureLogger(
      { log: (entry) => primaryEntries.push(entry) },
      { log: (entry) => apiEntries.push(entry) },
    );

    logger.log({ level: 'INFO', category: 'SYS', message: 'normal.ok' });
    logExternalApiFailure(logger, {
      source: 'krx',
      endpoint: 'https://example.invalid/krx',
      status: 500,
      reason: 'HTTP 500',
      durationMs: 12,
    });

    expect(primaryEntries).toHaveLength(2);
    expect(apiEntries).toHaveLength(1);
    expect(apiEntries[0]).toMatchObject({
      level: 'WARN',
      category: 'SYS',
      message: API_EXTERNAL_FAILED_MESSAGE,
      payload: {
        source: 'krx',
        endpoint: 'https://example.invalid/krx',
        status: 500,
        reason: 'HTTP 500',
        usedCache: false,
        stale: false,
        durationMs: 12,
      },
    });
  });
});

describe('splitErrorLogger', () => {
  it('ERROR는 error sink로, 나머지는 normal sink로 분리한다', () => {
    const normalEntries: unknown[] = [];
    const errorEntries: unknown[] = [];
    const logger = splitErrorLogger(
      { log: (entry) => normalEntries.push(entry) },
      { log: (entry) => errorEntries.push(entry) },
    );

    logger.log({ level: 'INFO', category: 'SYS', message: 'normal' });
    logger.log({ level: 'WARN', category: 'ORDER', message: 'warn' });
    logger.log({ level: 'ERROR', category: 'SYS', message: 'boom' });

    expect(normalEntries).toHaveLength(2);
    expect(errorEntries).toHaveLength(1);
    expect(errorEntries[0]).toMatchObject({ level: 'ERROR', message: 'boom' });
  });
});

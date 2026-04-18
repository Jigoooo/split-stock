import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { eventLogs } from '../db/schema';
import { createEventLogger, hashIdentifier, maskPayload } from './event-logger';

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

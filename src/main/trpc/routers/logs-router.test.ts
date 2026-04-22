import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../../db/bootstrap-schema';
import { createTestDb, type Db } from '../../db/client';
import { eventLogs } from '../../db/schema';
import type { Context } from '../context';
import { t } from '../trpc-core';
import { buildLogsCsv, buildLogsJson, logsRouter } from './logs-router';

const createCaller = t.createCallerFactory(logsRouter);

function setupDb(): Db {
  const db = createTestDb();
  bootstrapSchema(db);
  return db;
}

function ctxFor(db: Db): Context {
  return { db } as unknown as Context;
}

describe('logs-router', () => {
  it('tail: CANCEL 카테고리와 payload 검색이 함께 적용된다', async () => {
    const db = setupDb();
    db.insert(eventLogs)
      .values([
        {
          ts: new Date('2026-04-10T00:00:00Z'),
          level: 'WARN',
          category: 'CANCEL',
          message: 'watch.cancelled',
          payloadJson: '{"pdno":"005930","reason":"manual"}',
          auditPayload: null,
        },
        {
          ts: new Date('2026-04-11T00:00:00Z'),
          level: 'INFO',
          category: 'SYS',
          message: 'sys.heartbeat',
          payloadJson: '{"status":"ok"}',
          auditPayload: null,
        },
      ])
      .run();

    const caller = createCaller(ctxFor(db));
    const result = await caller.tail({
      categories: ['CANCEL'],
      limit: 10,
      search: '005930',
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      category: 'CANCEL',
      message: 'watch.cancelled',
    });
  });

  it('buildLogsCsv/buildLogsJson: payload를 사람이 읽기 쉬운 파일 형태로 직렬화한다', () => {
    const rows = [
      {
        id: 1,
        ts: new Date('2026-04-10T00:00:00Z'),
        level: 'WARN',
        category: 'ORDER',
        message: 'order.cash.business_error',
        payloadJson: '{"pdno":"005930","attempt":2}',
      },
      {
        id: 2,
        ts: new Date('2026-04-11T00:00:00Z'),
        level: 'ERROR',
        category: 'SYS',
        message: 'updater.failed',
        payloadJson: 'raw-text-payload',
      },
    ] as const;

    const csv = buildLogsCsv(rows);
    const json = buildLogsJson(rows);

    expect(csv).toContain('시각,레벨,카테고리,메시지,payload');
    expect(csv).toContain('order.cash.business_error');
    expect(csv).toContain('raw-text-payload');
    expect(json).toContain('"pdno": "005930"');
    expect(json).toContain('"payload": "raw-text-payload"');
  });
});

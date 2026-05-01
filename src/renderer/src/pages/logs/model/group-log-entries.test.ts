import { describe, expect, it } from 'vitest';
import { groupLogEntries } from './group-log-entries';
import type { LogEntry } from './use-log-tail';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 1,
    ts: '2026-04-10T09:00:00Z',
    level: 'INFO',
    category: 'ORDER',
    message: 'order.accepted',
    payloadJson: '{"pdno":"005930"}',
    ...overrides,
  };
}

describe('groupLogEntries', () => {
  it('60초 안의 연속 동일 로그를 묶는다', () => {
    const groups = groupLogEntries(
      [entry({ id: 2, ts: '2026-04-10T09:00:30Z' }), entry({ id: 1, ts: '2026-04-10T09:00:00Z' })],
      'desc',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, latest: expect.objectContaining({ id: 2 }) });
  });

  it('payload/category/message/level이 다르면 묶지 않는다', () => {
    const groups = groupLogEntries(
      [
        entry({ id: 5, payloadJson: '{"pdno":"000660"}' }),
        entry({ id: 4, category: 'SYS' }),
        entry({ id: 3, message: 'order.rejected' }),
        entry({ id: 2, level: 'WARN' }),
        entry({ id: 1 }),
      ],
      'desc',
    );

    expect(groups).toHaveLength(5);
    expect(groups.every((group) => group.count === 1)).toBe(true);
  });

  it('desc order에서 newest/oldest timestamp를 보존한다', () => {
    const groups = groupLogEntries(
      [
        entry({ id: 3, ts: '2026-04-10T09:00:40Z' }),
        entry({ id: 2, ts: '2026-04-10T09:00:20Z' }),
        entry({ id: 1, ts: '2026-04-10T09:00:00Z' }),
      ],
      'desc',
    );

    expect(groups[0]?.newestTs).toBe('2026-04-10T09:00:40Z');
    expect(groups[0]?.oldestTs).toBe('2026-04-10T09:00:00Z');
    expect(groups[0]?.latest.id).toBe(3);
  });

  it('asc order에서도 newest/oldest timestamp를 보존한다', () => {
    const groups = groupLogEntries(
      [
        entry({ id: 1, ts: '2026-04-10T09:00:00Z' }),
        entry({ id: 2, ts: '2026-04-10T09:00:20Z' }),
        entry({ id: 3, ts: '2026-04-10T09:00:40Z' }),
      ],
      'asc',
    );

    expect(groups[0]?.newestTs).toBe('2026-04-10T09:00:40Z');
    expect(groups[0]?.oldestTs).toBe('2026-04-10T09:00:00Z');
    expect(groups[0]?.latest.id).toBe(3);
  });
});

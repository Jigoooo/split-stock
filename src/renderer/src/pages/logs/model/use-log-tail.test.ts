import { describe, expect, it } from 'vitest';
import { buildLogQueryInput, type LogQueryFilters } from './use-log-tail';

function filters(overrides: Partial<LogQueryFilters> = {}): LogQueryFilters {
  return {
    categories: new Set(),
    dateRange: '',
    level: '',
    search: '',
    stream: '',
    ...overrides,
  };
}

describe('buildLogQueryInput', () => {
  it('tail/export 공통 필터를 동일한 query input 형태로 직렬화한다', () => {
    expect(
      buildLogQueryInput(
        filters({
          categories: new Set(['ORDER', '']),
          dateRange: 'today',
          level: 'WARN',
          search: '  005930  ',
          stream: 'normal',
        }),
        200,
      ),
    ).toEqual({
      categories: ['ORDER'],
      dateRange: 'today',
      level: 'WARN',
      limit: 200,
      search: '005930',
      stream: 'normal',
    });
  });

  it('빈 필터는 query input에서 생략한다', () => {
    expect(buildLogQueryInput(filters(), 200)).toEqual({ limit: 200 });
    expect(buildLogQueryInput(filters({ search: '   ' }))).toEqual({});
  });
});

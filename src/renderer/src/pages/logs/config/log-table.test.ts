import { describe, expect, it } from 'vitest';
import { formatLogTs } from './log-table';

describe('formatLogTs', () => {
  it('고정폭 날짜/시각 포맷으로 표시한다', () => {
    expect(formatLogTs(new Date(2026, 3, 10, 9, 5, 6))).toBe('2026-04-10 09:05:06');
  });

  it('유효하지 않은 시각은 대시로 표시한다', () => {
    expect(formatLogTs('not-a-date')).toBe('-');
  });
});

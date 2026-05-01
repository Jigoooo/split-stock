import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatDateTime, formatDateTimeLongKo, formatTimeOnly } from './date-time';

describe('date-time formatter', () => {
  const date = new Date(2026, 4, 1, 1, 2, 3);

  it('날짜/시간/날짜+시간을 고정폭 숫자 포맷으로 표시한다', () => {
    expect(formatDateOnly(date)).toBe('2026.05.01');
    expect(formatTimeOnly(date)).toBe('01:02:03');
    expect(formatDateTime(date)).toBe('2026.05.01 01:02:03');
  });

  it('긴 한국어 설명 포맷을 제공한다', () => {
    expect(formatDateTimeLongKo(date)).toBe('2026년 5월 1일 1시 2분 3초');
  });

  it('invalid, null, 0 값은 대시로 표시한다', () => {
    expect(formatDateOnly(null)).toBe('-');
    expect(formatTimeOnly(0)).toBe('-');
    expect(formatDateTime('not-a-date')).toBe('-');
    expect(formatDateTimeLongKo(new Date(Number.NaN))).toBe('-');
  });
});

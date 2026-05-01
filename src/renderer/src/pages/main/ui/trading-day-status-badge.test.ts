import type { TradingDayVerdict } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { getTradingDayStatusBadgeView } from './trading-day-status-badge';

function verdict(overrides: Partial<TradingDayVerdict> = {}): TradingDayVerdict {
  return {
    date: '20260430',
    openDay: true,
    openMinute: 540,
    closeMinute: 930,
    source: 'BUNDLED',
    sourceVersion: '2026-static-20260430',
    reason: 'REGULAR',
    confidence: 'MEDIUM',
    stale: false,
    checkedAt: 0,
    ...overrides,
  };
}

describe('getTradingDayStatusBadgeView', () => {
  it('내부 캘린더 출처 코드를 화면 텍스트에 노출하지 않는다', () => {
    const view = getTradingDayStatusBadgeView(verdict());

    expect(view.text).toBe('오늘 거래일');
    expect(view.text).not.toContain('BUNDLED');
    expect(view.title).toContain('앱 내장 캘린더');
  });

  it('휴장 사유는 title로 넘기고 화면 텍스트는 상태만 보여준다', () => {
    const view = getTradingDayStatusBadgeView(
      verdict({ openDay: false, openMinute: null, closeMinute: null, reason: 'WEEKEND' }),
    );

    expect(view.text).toBe('오늘 휴장');
    expect(view.title).toContain('주말');
    expect(view.className).toContain('chip--down');
  });

  it('KIS 검증 불일치는 거래 상태 옆에 유지한다', () => {
    const view = getTradingDayStatusBadgeView(verdict({ kisVerified: false }));

    expect(view.text).toBe('오늘 거래일 · KIS 불일치');
    expect(view.title).toContain('KIS 불일치');
  });
});

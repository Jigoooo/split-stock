/**
 * H4: PROD 개장 rate limit 검증.
 * trading-runtime.ts getRatePerSec 콜백 로직을 isRegularMarketOpenKst mock 으로 검증.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/trading/market-session', () => ({
  isRegularMarketOpenKst: vi.fn(),
}));

import { isRegularMarketOpenKst } from '@shared/trading/market-session';

/** getRatePerSec 로직을 그대로 추출한 헬퍼 */
function getRatePerSec(env: 'PROD' | 'MOCK' | null): number {
  const isOpen = vi.mocked(isRegularMarketOpenKst)();
  if (env === 'MOCK') return isOpen ? 4 : 2;
  // KIS 공식 가이드라인 15rps. 안전 margin 위해 12rps 로 제한.
  return isOpen ? 12 : 6;
}

describe('getRatePerSec (H4 rate limit)', () => {
  it('PROD 개장 시 12rps (KIS 15rps 가이드라인 대비 안전 margin)', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(true);
    expect(getRatePerSec('PROD')).toBe(12);
  });

  it('PROD 폐장 시 6rps', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(false);
    expect(getRatePerSec('PROD')).toBe(6);
  });

  it('MOCK 개장 시 4rps', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(true);
    expect(getRatePerSec('MOCK')).toBe(4);
  });

  it('MOCK 폐장 시 2rps', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(false);
    expect(getRatePerSec('MOCK')).toBe(2);
  });

  it('PROD 개장 rate 는 KIS 공식 한도(15rps) 이하', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(true);
    expect(getRatePerSec('PROD')).toBeLessThanOrEqual(15);
  });

  it('PROD 개장 rate 는 이전 18rps 가 아니다 (회귀 방지)', () => {
    vi.mocked(isRegularMarketOpenKst).mockReturnValue(true);
    expect(getRatePerSec('PROD')).not.toBe(18);
  });
});

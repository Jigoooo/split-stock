import { describe, expect, it } from 'vitest';
import { deriveNextBuyNth, hasActiveCycle } from './next-nth';

describe('deriveNextBuyNth', () => {
  it('활성 차수가 없으면 1차를 반환한다', () => {
    expect(deriveNextBuyNth([])).toBe(1);
    expect(
      deriveNextBuyNth([
        { nth: 1, status: 'SOLD' },
        { nth: 2, status: 'SELLING' },
      ]),
    ).toBe(1);
  });

  it('OPEN/BUYING 최대 차수 다음 번호를 반환한다', () => {
    expect(
      deriveNextBuyNth([
        { nth: 1, status: 'OPEN' },
        { nth: 2, status: 'BUYING' },
      ]),
    ).toBe(3);
  });

  it('과거 차수는 무시하고 현재 보유 차수 기준으로 계산한다', () => {
    expect(
      deriveNextBuyNth([
        { nth: 1, status: 'SOLD' },
        { nth: 2, status: 'OPEN' },
        { nth: 4, status: 'SOLD' },
      ]),
    ).toBe(3);
  });

  it('SELLING도 active cycle로 본다', () => {
    expect(
      hasActiveCycle([
        { status: 'SOLD' },
        { status: 'SELLING' },
      ]),
    ).toBe(true);
  });
});

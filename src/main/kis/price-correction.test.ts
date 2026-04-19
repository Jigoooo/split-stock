import { describe, expect, it } from 'vitest';
import { correctLimitPrice } from './price-correction';

const fakeOrderbook = {
  asks: [{ price: 35_100 }], // 매도1호가
  bids: [{ price: 35_000 }], // 매수1호가
};

describe('correctLimitPrice — orderbook 없음 (tick 방향 보정)', () => {
  describe('매수 AGGRESSIVE → 올림 (매도호가 측)', () => {
    it('35,075 → 35,100 (tick=100)', () => {
      expect(correctLimitPrice({ targetPrice: 35_075, side: 'BUY', strategy: 'AGGRESSIVE' })).toBe(
        35_100,
      );
    });

    it('5,025 → 5,050 (tick=50)', () => {
      expect(correctLimitPrice({ targetPrice: 5_025, side: 'BUY', strategy: 'AGGRESSIVE' })).toBe(
        5_050,
      );
    });
  });

  describe('매수 CONSERVATIVE → 내림 (매수호가 측)', () => {
    it('35,075 → 35,000 (tick=100)', () => {
      expect(
        correctLimitPrice({ targetPrice: 35_075, side: 'BUY', strategy: 'CONSERVATIVE' }),
      ).toBe(35_000);
    });

    it('5,025 → 5,000 (tick=50)', () => {
      expect(correctLimitPrice({ targetPrice: 5_025, side: 'BUY', strategy: 'CONSERVATIVE' })).toBe(
        5_000,
      );
    });
  });

  describe('매도 AGGRESSIVE → 내림 (매수호가 측)', () => {
    it('35,075 → 35,000 (tick=100)', () => {
      expect(correctLimitPrice({ targetPrice: 35_075, side: 'SELL', strategy: 'AGGRESSIVE' })).toBe(
        35_000,
      );
    });

    it('100,250 → 100,000 (tick=500)', () => {
      expect(
        correctLimitPrice({ targetPrice: 100_250, side: 'SELL', strategy: 'AGGRESSIVE' }),
      ).toBe(100_000);
    });
  });

  describe('매도 CONSERVATIVE → 올림 (매도호가 측)', () => {
    it('35,075 → 35,100 (tick=100)', () => {
      expect(
        correctLimitPrice({ targetPrice: 35_075, side: 'SELL', strategy: 'CONSERVATIVE' }),
      ).toBe(35_100);
    });

    it('100,250 → 100,500 (tick=500)', () => {
      expect(
        correctLimitPrice({ targetPrice: 100_250, side: 'SELL', strategy: 'CONSERVATIVE' }),
      ).toBe(100_500);
    });
  });

  it('이미 tick 단위에 맞으면 그대로 (no-op)', () => {
    expect(correctLimitPrice({ targetPrice: 35_000, side: 'BUY', strategy: 'AGGRESSIVE' })).toBe(
      35_000,
    );
    expect(correctLimitPrice({ targetPrice: 35_000, side: 'SELL', strategy: 'CONSERVATIVE' })).toBe(
      35_000,
    );
  });

  it('targetPrice ≤ 0 → 그대로 반환 (시장가 guard)', () => {
    expect(correctLimitPrice({ targetPrice: 0, side: 'BUY', strategy: 'AGGRESSIVE' })).toBe(0);
    expect(correctLimitPrice({ targetPrice: -1, side: 'SELL', strategy: 'AGGRESSIVE' })).toBe(-1);
  });
});

describe('correctLimitPrice — orderbook 있음 (snap 우선)', () => {
  it('AGGRESSIVE 매수 → bestAsk(35,100) snap', () => {
    expect(
      correctLimitPrice({
        targetPrice: 35_075,
        side: 'BUY',
        strategy: 'AGGRESSIVE',
        orderbook: fakeOrderbook,
      }),
    ).toBe(35_100);
  });

  it('CONSERVATIVE 매수 → bestBid(35,000) snap', () => {
    expect(
      correctLimitPrice({
        targetPrice: 35_075,
        side: 'BUY',
        strategy: 'CONSERVATIVE',
        orderbook: fakeOrderbook,
      }),
    ).toBe(35_000);
  });

  it('AGGRESSIVE 매도 → bestBid(35,000) snap', () => {
    expect(
      correctLimitPrice({
        targetPrice: 35_075,
        side: 'SELL',
        strategy: 'AGGRESSIVE',
        orderbook: fakeOrderbook,
      }),
    ).toBe(35_000);
  });

  it('CONSERVATIVE 매도 → bestAsk(35,100) snap', () => {
    expect(
      correctLimitPrice({
        targetPrice: 35_075,
        side: 'SELL',
        strategy: 'CONSERVATIVE',
        orderbook: fakeOrderbook,
      }),
    ).toBe(35_100);
  });

  it('orderbook snap 가격이 0이면 tick fallback', () => {
    const emptyOb = { asks: [{ price: 0 }], bids: [{ price: 0 }] };
    // AGGRESSIVE 매수 → tick fallback → 올림
    expect(
      correctLimitPrice({
        targetPrice: 35_075,
        side: 'BUY',
        strategy: 'AGGRESSIVE',
        orderbook: emptyOb,
      }),
    ).toBe(35_100);
  });

  it('이미 tick 에 맞으면 orderbook 무시하고 그대로', () => {
    expect(
      correctLimitPrice({
        targetPrice: 35_000,
        side: 'BUY',
        strategy: 'AGGRESSIVE',
        orderbook: fakeOrderbook,
      }),
    ).toBe(35_000);
  });
});

describe('correctLimitPrice — 가격대별 시나리오', () => {
  it('1,500원 (tick=5) AGGRESSIVE 매수 → 올림', () => {
    expect(correctLimitPrice({ targetPrice: 1_503, side: 'BUY', strategy: 'AGGRESSIVE' })).toBe(
      1_505,
    );
  });

  it('3,000원 (tick=10) CONSERVATIVE 매수 → 내림', () => {
    expect(correctLimitPrice({ targetPrice: 3_007, side: 'BUY', strategy: 'CONSERVATIVE' })).toBe(
      3_000,
    );
  });

  it('200,500원 (tick=1000) AGGRESSIVE 매도 → 내림', () => {
    expect(correctLimitPrice({ targetPrice: 200_500, side: 'SELL', strategy: 'AGGRESSIVE' })).toBe(
      200_000,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { createStockAdapter } from './asset-adapter';

describe('createStockAdapter', () => {
  it('returns kind=stock and KRW quote', () => {
    const adapter = createStockAdapter('005930');
    expect(adapter.kind).toBe('stock');
    expect(adapter.symbol).toBe('005930');
    expect(adapter.quoteCurrency).toBe('KRW');
  });

  it('formats price/volume/amount as KRW integer with ko-KR grouping', () => {
    const adapter = createStockAdapter('005930');
    expect(adapter.formatPrice(70000)).toBe('70,000');
    expect(adapter.formatVolume(123456)).toBe('123,456');
    expect(adapter.formatAmount('98765432')).toBe('98,765,432');
  });

  it('returns "-" for invalid format inputs', () => {
    const adapter = createStockAdapter('005930');
    expect(adapter.formatPrice(null)).toBe('-');
    expect(adapter.formatPrice(undefined)).toBe('-');
    expect(adapter.formatPrice('')).toBe('-');
    expect(adapter.formatPrice('abc')).toBe('-');
  });

  it('uses KRX tickSize bands for price-dependent ticks', () => {
    const adapter = createStockAdapter('005930');
    // 2023.01.25 개정: 2,000원 미만 = 1, 2,000~5,000 = 5, 5,000~20,000 = 10
    expect(adapter.tickSize(1500)).toBe(1);
    expect(adapter.tickSize(3000)).toBe(5);
    expect(adapter.tickSize(10000)).toBe(10);
  });

  it('maps limit/market to KIS ORD_DVSN codes (00/01) regardless of side', () => {
    const adapter = createStockAdapter('005930');
    expect(adapter.orderTypeMap.limit).toBe('00');
    expect(adapter.orderTypeMap.market).toBe('01');
    expect(adapter.resolveMarketOrderType('buy')).toBe('01');
    expect(adapter.resolveMarketOrderType('sell')).toBe('01');
  });
});

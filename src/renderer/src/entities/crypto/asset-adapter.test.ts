import { describe, expect, it } from 'vitest';
import { createCryptoAdapter } from './asset-adapter';

describe('createCryptoAdapter', () => {
  it('returns kind=crypto and quote derived from market prefix', () => {
    const krw = createCryptoAdapter('KRW-BTC');
    expect(krw.kind).toBe('crypto');
    expect(krw.symbol).toBe('KRW-BTC');
    expect(krw.quoteCurrency).toBe('KRW');

    const btc = createCryptoAdapter('BTC-ETH');
    expect(btc.quoteCurrency).toBe('BTC');
  });

  it('formats price with KRW integer for KRW markets', () => {
    const adapter = createCryptoAdapter('KRW-BTC');
    expect(adapter.formatPrice(100000000)).toBe('100,000,000');
  });

  it('formats price with up to 8 decimals for non-KRW/USDT markets', () => {
    const adapter = createCryptoAdapter('BTC-XRP');
    expect(adapter.formatPrice(0.00001234)).toBe('0.00001234');
  });

  it('formats volume with 8-decimal precision', () => {
    const adapter = createCryptoAdapter('KRW-BTC');
    expect(adapter.formatVolume(0.00012345)).toBe('0.00012345');
  });

  it('returns "-" for invalid format inputs', () => {
    const adapter = createCryptoAdapter('KRW-BTC');
    expect(adapter.formatPrice(null)).toBe('-');
    expect(adapter.formatPrice(undefined)).toBe('-');
  });

  it('uses fixed tickSize from options regardless of price', () => {
    const adapter = createCryptoAdapter('KRW-BTC', { tickSize: 1000 });
    expect(adapter.tickSize(50000000)).toBe(1000);
    expect(adapter.tickSize(1)).toBe(1000);
  });

  it('falls back to tickSize=1 when option is omitted', () => {
    const adapter = createCryptoAdapter('KRW-BTC');
    expect(adapter.tickSize(0)).toBe(1);
  });

  it('maps limit/market to UPBIT ord_type and splits market by side', () => {
    const adapter = createCryptoAdapter('KRW-BTC');
    expect(adapter.orderTypeMap.limit).toBe('limit');
    expect(adapter.orderTypeMap.market).toBe('market');
    // UPBIT 매수 시장가 = price (KRW 금액), 매도 시장가 = market (수량)
    expect(adapter.resolveMarketOrderType('buy')).toBe('price');
    expect(adapter.resolveMarketOrderType('sell')).toBe('market');
  });
});

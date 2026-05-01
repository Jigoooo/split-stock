import { describe, expect, it } from 'vitest';
import { formatCryptoPrice, formatCryptoVolume, isDecimalOnTick } from './crypto-format';

describe('crypto-format', () => {
  it('keeps crypto decimal precision visible', () => {
    expect(formatCryptoPrice('0.00000012', 'KRW-TEST')).toBe('0.00000012');
    expect(formatCryptoVolume('0.123456789')).toBe('0.12345679');
  });

  it('validates decimal tick size without floating point drift', () => {
    expect(isDecimalOnTick('0.00000012', '0.00000001')).toBe(true);
    expect(isDecimalOnTick('5000.5', '0.5')).toBe(true);
    expect(isDecimalOnTick('5000.25', '0.5')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { decimalGte, decimalMul } from './decimal';

describe('upbit decimal helpers', () => {
  it('compares decimal strings without floating point rounding', () => {
    expect(decimalGte('0.3', '0.1')).toBe(true);
    expect(decimalGte('0.00000001', '0.000000010')).toBe(true);
    expect(decimalGte('9999999999999999.99999999', '9999999999999999.99999998')).toBe(true);
    expect(decimalGte('9999999999999999.99999998', '9999999999999999.99999999')).toBe(false);
  });

  it('multiplies decimal strings without binary float artifacts', () => {
    expect(decimalMul('0.1', '0.2')).toBe('0.02');
    expect(decimalMul('1000000.5', '0.001')).toBe('1000.0005');
    expect(decimalMul('10000', '0.00000001')).toBe('0.0001');
  });
});

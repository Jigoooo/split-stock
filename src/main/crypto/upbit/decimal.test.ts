import { describe, expect, it } from 'vitest';
import {
  assertDecimalString,
  DecimalValidationError,
  decimalCeilToStep,
  decimalFloorToStep,
  decimalGte,
  decimalMul,
  normalizeUpbitKrwLimitPrice,
  upbitKrwTickSizeForPrice,
} from './decimal';

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

  it('fails closed for automation decimal validation', () => {
    expect(assertDecimalString('0.00000001')).toBe('0.00000001');
    expect(() => assertDecimalString('')).toThrow(DecimalValidationError);
    expect(() => assertDecimalString('NaN')).toThrow(DecimalValidationError);
    expect(() => assertDecimalString('-1')).toThrow(DecimalValidationError);
    expect(() => assertDecimalString('0')).toThrow(DecimalValidationError);
    expect(assertDecimalString('0', { allowZero: true })).toBe('0');
  });

  it('normalizes KRW limit prices to the current Upbit tick policy', () => {
    expect(upbitKrwTickSizeForPrice('1000000')).toBe('1000');
    expect(upbitKrwTickSizeForPrice('500000')).toBe('500');
    expect(upbitKrwTickSizeForPrice('5000')).toBe('5');
    expect(upbitKrwTickSizeForPrice('15')).toBe('0.1');
    expect(upbitKrwTickSizeForPrice('0.000009')).toBe('0.00000001');
    expect(decimalFloorToStep('1001.9', '5')).toBe('1000');
    expect(decimalCeilToStep('1001.1', '5')).toBe('1005');
    expect(normalizeUpbitKrwLimitPrice('5012', 'floor')).toBe('5010');
  });
});

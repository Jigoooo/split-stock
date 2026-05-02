import { DecimalStringSchema } from '@shared/contracts';

export function decimalString(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '0';
}

export function isDecimalString(value: string): boolean {
  return DecimalStringSchema.safeParse(value).success;
}

type ParsedDecimal = {
  mantissa: bigint;
  scale: number;
};

export class DecimalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalValidationError';
  }
}

function parseDecimal(value: string | undefined): ParsedDecimal {
  const source = value?.trim();
  if (!source || !isDecimalString(source)) return { mantissa: 0n, scale: 0 };
  const [whole = '0', fractional = ''] = source.split('.');
  return {
    mantissa: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

export function parseStrictDecimal(
  value: string,
  options: { allowZero?: boolean; field?: string } = {},
): ParsedDecimal {
  const source = value.trim();
  const field = options.field ?? 'decimal';
  if (!source || !isDecimalString(source)) {
    throw new DecimalValidationError(`${field} must be a decimal string`);
  }
  const [whole = '0', fractional = ''] = source.split('.');
  const parsed = {
    mantissa: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
  if (!options.allowZero && parsed.mantissa === 0n) {
    throw new DecimalValidationError(`${field} must be greater than zero`);
  }
  return parsed;
}

export function assertDecimalString(
  value: string,
  options: { allowZero?: boolean; field?: string } = {},
): string {
  parseStrictDecimal(value, options);
  return value.trim();
}

function alignDecimals(left: ParsedDecimal, right: ParsedDecimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.mantissa * 10n ** BigInt(scale - left.scale),
    right.mantissa * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

export function decimalCompareStrict(left: string, right: string): -1 | 0 | 1 {
  const [l, r] = alignDecimals(
    parseStrictDecimal(left, { allowZero: true, field: 'left' }),
    parseStrictDecimal(right, { allowZero: true, field: 'right' }),
  );
  if (l === r) return 0;
  return l > r ? 1 : -1;
}

export function decimalGte(left: string, right: string): boolean {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  const scale = Math.max(l.scale, r.scale);
  return l.mantissa * 10n ** BigInt(scale - l.scale) >= r.mantissa * 10n ** BigInt(scale - r.scale);
}

export function decimalLteStrict(left: string, right: string): boolean {
  return decimalCompareStrict(left, right) <= 0;
}

export function decimalGteStrict(left: string, right: string): boolean {
  return decimalCompareStrict(left, right) >= 0;
}

export function decimalGtStrict(left: string, right: string): boolean {
  return decimalCompareStrict(left, right) > 0;
}

export function decimalMul(left: string, right: string): string {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  const scale = l.scale + r.scale;
  const raw = String(l.mantissa * r.mantissa).padStart(scale + 1, '0');
  if (scale === 0) return raw;
  const whole = raw.slice(0, -scale);
  const fractional = raw.slice(-scale).replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole;
}

export function decimalAdd(left: string, right: string): string {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  const scale = Math.max(l.scale, r.scale);
  const value =
    l.mantissa * 10n ** BigInt(scale - l.scale) + r.mantissa * 10n ** BigInt(scale - r.scale);
  return formatScaled(value, scale);
}

export function decimalSub(left: string, right: string): string {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  const scale = Math.max(l.scale, r.scale);
  const value =
    l.mantissa * 10n ** BigInt(scale - l.scale) - r.mantissa * 10n ** BigInt(scale - r.scale);
  return formatScaled(value, scale);
}

export function decimalDiv(left: string, right: string, precision = 8): string {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  if (r.mantissa === 0n) return '0';
  const scale = Math.max(0, Math.trunc(precision));
  const numerator = l.mantissa * 10n ** BigInt(scale + r.scale);
  const denominator = r.mantissa * 10n ** BigInt(l.scale);
  return formatScaled(numerator / denominator, scale);
}

export function decimalAddStrict(left: string, right: string): string {
  parseStrictDecimal(left, { allowZero: true, field: 'left' });
  parseStrictDecimal(right, { allowZero: true, field: 'right' });
  return decimalAdd(left, right);
}

export function decimalSubStrict(left: string, right: string): string {
  parseStrictDecimal(left, { allowZero: true, field: 'left' });
  parseStrictDecimal(right, { allowZero: true, field: 'right' });
  return decimalSub(left, right);
}

export function decimalMulStrict(left: string, right: string): string {
  parseStrictDecimal(left, { allowZero: true, field: 'left' });
  parseStrictDecimal(right, { allowZero: true, field: 'right' });
  return decimalMul(left, right);
}

export function decimalDivStrict(left: string, right: string, precision = 8): string {
  parseStrictDecimal(left, { allowZero: true, field: 'left' });
  parseStrictDecimal(right, { allowZero: false, field: 'right' });
  return decimalDiv(left, right, precision);
}

export const UPBIT_KRW_MIN_ORDER_TOTAL = '5000';

/**
 * Upbit KRW market policy effective after the 2025-07-31 tick-unit change.
 * Official doc: https://docs.upbit.com/kr/docs/krw-market-info
 */
export function upbitKrwTickSizeForPrice(price: string): string {
  assertDecimalString(price, { field: 'price' });
  if (decimalGteStrict(price, '1000000')) return '1000';
  if (decimalGteStrict(price, '500000')) return '500';
  if (decimalGteStrict(price, '100000')) return '100';
  if (decimalGteStrict(price, '50000')) return '50';
  if (decimalGteStrict(price, '10000')) return '10';
  if (decimalGteStrict(price, '5000')) return '5';
  if (decimalGteStrict(price, '1000')) return '1';
  if (decimalGteStrict(price, '100')) return '1';
  if (decimalGteStrict(price, '10')) return '0.1';
  if (decimalGteStrict(price, '1')) return '0.01';
  if (decimalGteStrict(price, '0.1')) return '0.001';
  if (decimalGteStrict(price, '0.01')) return '0.0001';
  if (decimalGteStrict(price, '0.001')) return '0.00001';
  if (decimalGteStrict(price, '0.0001')) return '0.000001';
  if (decimalGteStrict(price, '0.00001')) return '0.0000001';
  return '0.00000001';
}

export function decimalFloorToStep(value: string, step: string): string {
  const parsedValue = parseStrictDecimal(value, { allowZero: true, field: 'value' });
  const parsedStep = parseStrictDecimal(step, { field: 'step' });
  const scale = Math.max(parsedValue.scale, parsedStep.scale);
  const valueMantissa = parsedValue.mantissa * 10n ** BigInt(scale - parsedValue.scale);
  const stepMantissa = parsedStep.mantissa * 10n ** BigInt(scale - parsedStep.scale);
  return formatScaled((valueMantissa / stepMantissa) * stepMantissa, scale);
}

export function decimalCeilToStep(value: string, step: string): string {
  const parsedValue = parseStrictDecimal(value, { allowZero: true, field: 'value' });
  const parsedStep = parseStrictDecimal(step, { field: 'step' });
  const scale = Math.max(parsedValue.scale, parsedStep.scale);
  const valueMantissa = parsedValue.mantissa * 10n ** BigInt(scale - parsedValue.scale);
  const stepMantissa = parsedStep.mantissa * 10n ** BigInt(scale - parsedStep.scale);
  const quotient = valueMantissa / stepMantissa;
  const rounded =
    valueMantissa % stepMantissa === 0n ? valueMantissa : (quotient + 1n) * stepMantissa;
  return formatScaled(rounded, scale);
}

export function normalizeUpbitKrwLimitPrice(
  price: string,
  direction: 'floor' | 'ceil' = 'floor',
): string {
  const tickSize = upbitKrwTickSizeForPrice(price);
  return direction === 'ceil'
    ? decimalCeilToStep(price, tickSize)
    : decimalFloorToStep(price, tickSize);
}

function formatScaled(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  if (scale === 0) return `${sign}${abs}`;
  const raw = String(abs).padStart(scale + 1, '0');
  const whole = raw.slice(0, -scale);
  const fractional = raw.slice(-scale).replace(/0+$/, '');
  return fractional ? `${sign}${whole}.${fractional}` : `${sign}${whole}`;
}

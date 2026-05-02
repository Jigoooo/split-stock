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

function parseDecimal(value: string | undefined): ParsedDecimal {
  const source = value?.trim();
  if (!source || !isDecimalString(source)) return { mantissa: 0n, scale: 0 };
  const [whole = '0', fractional = ''] = source.split('.');
  return {
    mantissa: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

export function decimalGte(left: string, right: string): boolean {
  const l = parseDecimal(left);
  const r = parseDecimal(right);
  const scale = Math.max(l.scale, r.scale);
  return l.mantissa * 10n ** BigInt(scale - l.scale) >= r.mantissa * 10n ** BigInt(scale - r.scale);
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

function formatScaled(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  if (scale === 0) return `${sign}${abs}`;
  const raw = String(abs).padStart(scale + 1, '0');
  const whole = raw.slice(0, -scale);
  const fractional = raw.slice(-scale).replace(/0+$/, '');
  return fractional ? `${sign}${whole}.${fractional}` : `${sign}${whole}`;
}

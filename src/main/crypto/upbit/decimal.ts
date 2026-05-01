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

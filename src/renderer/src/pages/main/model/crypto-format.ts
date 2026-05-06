import { QUOTE_CURRENCIES, type QuoteCurrency } from '@shared/contracts';

export function getCryptoQuote(market: string): QuoteCurrency | string {
  return market.split('-')[0] ?? '';
}

export function formatCryptoDecimal(
  value: string | number | undefined,
  options: { maxFractionDigits?: number; minFractionDigits?: number } = {},
): string {
  if (value === undefined || value === '') return '-';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const maxFractionDigits = options.maxFractionDigits ?? 8;
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: options.minFractionDigits ?? 0,
  }).format(numeric);
}

export function formatCryptoPrice(
  value: string | number | undefined,
  marketOrQuote: string,
): string {
  const quote = marketOrQuote.includes('-') ? getCryptoQuote(marketOrQuote) : marketOrQuote;
  if (quote === QUOTE_CURRENCIES.KRW) return formatCryptoDecimal(value, { maxFractionDigits: 0 });
  if (quote === QUOTE_CURRENCIES.USDT) return formatCryptoDecimal(value, { maxFractionDigits: 6 });
  return formatCryptoDecimal(value, { maxFractionDigits: 8 });
}

export function formatCryptoVolume(value: string | number | undefined): string {
  return formatCryptoDecimal(value, { maxFractionDigits: 8 });
}

export function formatCryptoAmount(
  value: string | number | undefined,
  marketOrQuote: string,
): string {
  return formatCryptoPrice(value, marketOrQuote);
}

export function isDecimalOnTick(value: string, tickSize: string | undefined): boolean {
  if (!tickSize || !value) return true;
  const parsedValue = parseDecimal(value);
  const parsedTick = parseDecimal(tickSize);
  if (!parsedValue || !parsedTick || parsedTick.mantissa === 0n) return false;
  const scale = Math.max(parsedValue.scale, parsedTick.scale);
  const valueMantissa = parsedValue.mantissa * 10n ** BigInt(scale - parsedValue.scale);
  const tickMantissa = parsedTick.mantissa * 10n ** BigInt(scale - parsedTick.scale);
  return valueMantissa % tickMantissa === 0n;
}

export function decimalAdd(left: string | undefined, right: string | undefined): string {
  const l = parseDecimal(left ?? '0');
  const r = parseDecimal(right ?? '0');
  if (!l || !r) return '0';
  const scale = Math.max(l.scale, r.scale);
  const value =
    l.mantissa * 10n ** BigInt(scale - l.scale) + r.mantissa * 10n ** BigInt(scale - r.scale);
  return formatScaledDecimal(value, scale);
}

export function decimalSub(left: string | undefined, right: string | undefined): string {
  const l = parseDecimal(left ?? '0');
  const r = parseDecimal(right ?? '0');
  if (!l || !r) return '0';
  const scale = Math.max(l.scale, r.scale);
  const value =
    l.mantissa * 10n ** BigInt(scale - l.scale) - r.mantissa * 10n ** BigInt(scale - r.scale);
  return formatScaledDecimal(value, scale);
}

export function decimalMul(left: string | undefined, right: string | undefined): string {
  const l = parseDecimal(left ?? '0');
  const r = parseDecimal(right ?? '0');
  if (!l || !r) return '0';
  const scale = l.scale + r.scale;
  return formatScaledDecimal(l.mantissa * r.mantissa, scale);
}

export function decimalDiv(
  left: string | undefined,
  right: string | undefined,
  precision = 8,
): string {
  const l = parseDecimal(left ?? '0');
  const r = parseDecimal(right ?? '0');
  if (!l || !r || r.mantissa === 0n) return '0';
  const scale = Math.max(0, Math.trunc(precision));
  const numerator = l.mantissa * 10n ** BigInt(scale + r.scale);
  const denominator = r.mantissa * 10n ** BigInt(l.scale);
  return formatScaledDecimal(numerator / denominator, scale);
}

export function decimalRatioPercent(value: string | undefined, max: string | undefined): number {
  const v = parseDecimal(value ?? '0');
  const m = parseDecimal(max ?? '0');
  if (!v || !m || m.mantissa === 0n) return 0;
  const scale = Math.max(v.scale, m.scale);
  const valueMantissa = v.mantissa * 10n ** BigInt(scale - v.scale);
  const maxMantissa = m.mantissa * 10n ** BigInt(scale - m.scale);
  return Number((valueMantissa * 100n) / maxMantissa);
}

export function decimalGt(left: string | undefined, right: string | undefined): boolean {
  const l = parseDecimal(left ?? '0');
  const r = parseDecimal(right ?? '0');
  if (!l || !r) return false;
  const scale = Math.max(l.scale, r.scale);
  return l.mantissa * 10n ** BigInt(scale - l.scale) > r.mantissa * 10n ** BigInt(scale - r.scale);
}

function parseDecimal(value: string): { mantissa: bigint; scale: number } | null {
  const trimmed = value.trim();
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const source = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = source.split('.');
  return {
    mantissa: BigInt(`${negative ? '-' : ''}${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatScaledDecimal(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  if (scale === 0) return `${sign}${abs}`;
  const raw = String(abs).padStart(scale + 1, '0');
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

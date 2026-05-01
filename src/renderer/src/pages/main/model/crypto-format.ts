export function getCryptoQuote(market: string): 'KRW' | 'BTC' | 'USDT' | string {
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
  if (quote === 'KRW') return formatCryptoDecimal(value, { maxFractionDigits: 8 });
  if (quote === 'USDT') return formatCryptoDecimal(value, { maxFractionDigits: 6 });
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

function parseDecimal(value: string): { mantissa: bigint; scale: number } | null {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return {
    mantissa: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

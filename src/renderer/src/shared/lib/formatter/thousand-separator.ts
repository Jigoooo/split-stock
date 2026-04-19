export interface ThousandSeparatorOptions {
  allowNegative?: boolean;
  allowDecimal?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export function thousandSeparator(
  number?: string | number,
  options: ThousandSeparatorOptions = {},
): string {
  const {
    allowNegative = false,
    allowDecimal = true,
    minimumFractionDigits,
    maximumFractionDigits,
  } = options;

  if (number === undefined || number === null || number === '') return '';

  const stringValue = String(number).replaceAll(',', '');
  const cleanedValue = allowDecimal ? stringValue : stringValue.replace(/\./g, '');
  const endsWithDot = allowDecimal && cleanedValue.endsWith('.');
  const decimalMatch = allowDecimal ? cleanedValue.match(/\.(\d*)$/) : null;
  const trailingDecimal = decimalMatch?.[1] ?? '';
  const numericValue = Number(cleanedValue);

  if (Number.isNaN(numericValue)) {
    return '';
  }

  if (!allowNegative && numericValue < 0) {
    return '0';
  }

  if (endsWithDot) {
    return `${numericValue.toLocaleString('ko-KR')}.`;
  }

  if (trailingDecimal !== '') {
    const maxFraction = maximumFractionDigits ?? trailingDecimal.length;
    const minFraction = Math.min(minimumFractionDigits ?? trailingDecimal.length, maxFraction);

    return numericValue.toLocaleString('ko-KR', {
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    });
  }

  return numericValue.toLocaleString('ko-KR', {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

import type { InputHTMLAttributes, ReactElement } from 'react';
import { thousandSeparator } from '../lib/formatter';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'>;

export interface NumberInputProps extends NativeInputProps {
  value: string;
  onValueChange: (nextRaw: string) => void;
  emptyDisplay?: string;
  dense?: boolean;
  allowNegative?: boolean;
  allowDecimal?: boolean;
}

export const NumberInput = ({
  value,
  onValueChange,
  emptyDisplay,
  dense = false,
  allowNegative = false,
  allowDecimal = false,
  className,
  disabled,
  inputMode,
  ...props
}: NumberInputProps): ReactElement => {
  const displayValue =
    disabled && emptyDisplay && value.trim() === ''
      ? emptyDisplay
      : value.trim() === ''
        ? ''
        : thousandSeparator(value, {
            allowNegative,
            allowDecimal,
          });

  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode ?? (allowDecimal ? 'decimal' : 'numeric')}
      disabled={disabled}
      value={displayValue}
      onChange={(event) => {
        onValueChange(sanitizeNumberInput(event.target.value, { allowNegative, allowDecimal }));
      }}
      className={['hts-input', 'hts-input--num', dense ? 'hts-input--dense' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    />
  );
};

function sanitizeNumberInput(
  value: string,
  options: Pick<NumberInputProps, 'allowNegative' | 'allowDecimal'>,
): string {
  const { allowNegative = false, allowDecimal = false } = options;
  let next = value.replaceAll(',', '').trim();

  const hasNegative = allowNegative && next.startsWith('-');
  if (hasNegative) {
    next = next.slice(1);
  }

  next = allowDecimal ? next.replace(/[^0-9.]/g, '') : next.replace(/\D/g, '');

  if (allowDecimal) {
    const [rawIntegerPart, ...fractionParts] = next.split('.');
    const integerPart = rawIntegerPart ?? '';
    next = fractionParts.length > 0 ? `${integerPart}.${fractionParts.join('')}` : integerPart;
  }

  return hasNegative ? `-${next}` : next;
}

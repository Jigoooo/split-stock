import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CSSProperties, InputHTMLAttributes, ReactElement } from 'react';
import { thousandSeparator } from '../../../lib/formatter';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'>;

export interface NumberInputProps extends NativeInputProps {
  value: string;
  onValueChange: (nextRaw: string) => void;
  emptyDisplay?: string;
  dense?: boolean;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  /** 위/아래 화살표 spinner 표시. native spin button 은 항상 숨김. */
  showSpinner?: boolean;
  /** spinner 클릭 시 증감 단위 (default 1, allowDecimal 이면 0.01 권장). */
  step?: number;
  /** spinner clamp 용 min (allowNegative=false 이면 0 으로 자동 clamp). */
  min?: number | string;
  /** spinner clamp 용 max. */
  max?: number | string;
}

/**
 * 숫자 텍스트 인풋 — 천단위 콤마 + sanitize.
 *
 * showSpinner=true 이면 우측에 lucide ChevronUp/Down 버튼이 붙고, native spin button 은 숨김.
 * spinner 클릭은 현재 value(string) 를 number 로 변환 → step 가감 → string 으로 다시
 * onValueChange 호출. min/max 가 명시되면 clamp.
 */
export const NumberInput = ({
  value,
  onValueChange,
  emptyDisplay,
  dense = false,
  allowNegative = false,
  allowDecimal = false,
  showSpinner = false,
  step = 1,
  min,
  max,
  className,
  disabled,
  inputMode,
  style,
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

  const adjust = (delta: number): void => {
    if (disabled) return;
    const raw = value.replaceAll(',', '').trim();
    const current = raw === '' || raw === '-' ? 0 : Number(raw);
    if (!Number.isFinite(current)) return;
    let next = current + delta;
    const minNum = typeof min === 'string' ? Number(min) : min;
    const maxNum = typeof max === 'string' ? Number(max) : max;
    const lowerBound = Number.isFinite(minNum) ? (minNum as number) : allowNegative ? -Infinity : 0;
    if (next < lowerBound) next = lowerBound;
    if (Number.isFinite(maxNum) && next > (maxNum as number)) next = maxNum as number;
    if (next === current) return;
    const formatted = allowDecimal
      ? String(Number(next.toFixed(8))) // 부동소수점 잡음 제거
      : String(Math.trunc(next));
    onValueChange(formatted);
  };

  const inputEl = (
    <input
      {...props}
      type="text"
      inputMode={inputMode ?? (allowDecimal ? 'decimal' : 'numeric')}
      disabled={disabled}
      value={displayValue}
      onChange={(event) => {
        onValueChange(sanitizeNumberInput(event.target.value, { allowNegative, allowDecimal }));
      }}
      className={[
        'hts-input',
        'hts-input--num',
        dense ? 'hts-input--dense' : '',
        showSpinner ? 'number-input__field' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        showSpinner
          ? {
              flex: 1,
              minWidth: 0,
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              ...style,
            }
          : style
      }
    />
  );

  if (!showSpinner) return inputEl;

  // spinner 모드 — 외곽 컨테이너가 border 를 책임지고 input 은 border 없이 채움.
  return (
    <span
      className={`number-input ${dense ? 'number-input--dense' : ''}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        width: '100%',
        minHeight: dense ? '2.8rem' : '3rem',
        background: 'var(--bg)',
        border: '0.1rem solid var(--border-strong)',
        borderRadius: '0.3rem',
        overflow: 'hidden',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {inputEl}
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          borderLeft: '0.1rem solid var(--border)',
          width: '1.6rem',
          minWidth: '1.6rem',
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => adjust(step)}
          aria-label="값 증가"
          style={spinnerBtnStyle('top')}
        >
          <ChevronUp size={10} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => adjust(-step)}
          aria-label="값 감소"
          style={spinnerBtnStyle('bottom')}
        >
          <ChevronDown size={10} />
        </button>
      </span>
    </span>
  );
};

function spinnerBtnStyle(pos: 'top' | 'bottom'): CSSProperties {
  return {
    flex: 1,
    width: '1.6rem',
    background: 'var(--bg-3, var(--bg))',
    color: 'var(--fg-2, var(--fg))',
    border: 'none',
    borderTop: pos === 'bottom' ? '0.1rem solid var(--border)' : 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

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

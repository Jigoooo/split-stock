import { useColors } from '@renderer/shared/theme';
import { CalendarDays, ChevronDown } from 'lucide-react';
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import { useState } from 'react';
import { formatPickerDate } from '../lib/date-picker-values';
import { useDatePickerContext } from '../model/date-picker-context';
import type { DatePickerTriggerProps } from '../model/types';

export function DatePickerTrigger({
  onBlur,
  onFocus,
  onKeyDown,
  onPointerDown,
  placeholder,
  style,
  ...triggerProps
}: DatePickerTriggerProps) {
  const colors = useColors();
  const [isFocusVisible, setIsFocusVisible] = useState(false);
  const {
    mode,
    dateFormat,
    disabled,
    selectedDate,
    placeholder: contextPlaceholder,
    isOpen,
    setReference,
    getReferenceProps,
  } = useDatePickerContext();

  const label = selectedDate ? formatPickerDate(selectedDate, mode, dateFormat) : '';
  const isActive = isOpen || isFocusVisible;
  const referenceProps = getReferenceProps({
    ...triggerProps,
    onPointerDown: (event) => {
      onPointerDown?.(event as PointerEvent<HTMLButtonElement>);
      setIsFocusVisible(false);
    },
    onFocus: (event) => {
      onFocus?.(event as FocusEvent<HTMLButtonElement>);
      setIsFocusVisible(event.currentTarget.matches(':focus-visible'));
    },
    onBlur: (event) => {
      onBlur?.(event as FocusEvent<HTMLButtonElement>);
      setIsFocusVisible(false);
    },
    onKeyDown: (event) => {
      onKeyDown?.(event as KeyboardEvent<HTMLButtonElement>);
      if (
        event.key === 'Tab' ||
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key.startsWith('Arrow')
      ) {
        setIsFocusVisible(true);
      }
    },
  });

  return (
    <button
      ref={setReference}
      type="button"
      disabled={disabled}
      {...referenceProps}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      style={{
        width: '100%',
        minHeight: '4rem',
        padding: '0.9rem 1.2rem',
        borderRadius: '1.1rem',
        border: `1px solid ${isActive ? colors.border.focus : colors.border.default}`,
        backgroundColor: colors.bg.elevated,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.8rem',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: isFocusVisible
          ? `0 0 0 0.4rem ${colors.bg.overlayHover}`
          : `0 10px 26px -22px ${colors.shadow.floating}`,
        transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
        textAlign: 'left',
        ...style,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.8rem',
          minWidth: 0,
          color: label ? colors.text.primary : colors.text.tertiary,
          fontSize: '1.5rem',
          lineHeight: 1.4,
        }}
      >
        <CalendarDays size={18} color={label ? colors.interactive.primary : colors.text.tertiary} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label || placeholder || contextPlaceholder}
        </span>
      </span>
      <ChevronDown size={18} color={colors.text.tertiary} />
    </button>
  );
}

import { CalendarDays, ChevronDown } from 'lucide-react';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { useColors } from '../../../theme';
import { DateInput } from '../../date-input';
import type { DatePickerTriggerProps } from '../model/types';
import { DatePickerValue } from './date-picker-value';

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const DatePickerTrigger = memo(
  ({
    children,
    className,
    placeholder = '날짜 선택',
    style,
    ...props
  }: DatePickerTriggerProps): ReactElement => {
    const colors = useColors();

    return (
      <DateInput.Trigger
        {...props}
        className={joinClasses('hts-date-picker__trigger', className)}
        style={{
          width: '100%',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          padding: 0,
          border: 0,
          background: 'transparent',
          color: colors.text.primary,
          ...style,
        }}
      >
        <span className="hts-date-picker__label-wrap">
          <span
            className="hts-date-picker__leading"
            aria-hidden
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '0.7rem',
              background: colors.interactive.primarySurface,
            }}
          >
            <CalendarDays size={14} color={colors.interactive.primary} />
          </span>
          {children ?? <DatePickerValue placeholder={placeholder} />}
        </span>
        <span
          className="hts-date-picker__icon"
          aria-hidden
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.7rem',
            background: colors.bg.subtle,
            color: colors.text.secondary,
          }}
        >
          <ChevronDown size={14} />
        </span>
      </DateInput.Trigger>
    );
  },
);

DatePickerTrigger.displayName = 'DatePickerTrigger';

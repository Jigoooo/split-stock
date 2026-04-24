import type { ReactElement } from 'react';
import { memo } from 'react';
import { useDatePickerContext } from '../../date-input';
import type { DatePickerValueProps } from '../model/types';

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const DatePickerValue = memo(
  ({ placeholder = '날짜 선택' }: DatePickerValueProps): ReactElement => {
    const context = useDatePickerContext('DatePicker.Value');
    const hasValue = context.value.trim() !== '';

    return (
      <span
        className={joinClasses(
          'hts-date-picker__value',
          !hasValue && 'hts-date-picker__value--placeholder',
        )}
      >
        {hasValue ? context.value : placeholder}
      </span>
    );
  },
);

DatePickerValue.displayName = 'DatePickerValue';

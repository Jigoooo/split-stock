import { formatPickerDate } from '../lib/date-picker-values';
import { useDatePickerContext } from '../model/date-picker-context';
import type { BaseDatePickerProps } from '../model/types';
import { DatePickerCalendar } from './date-picker-calendar';
import { DatePickerContent } from './date-picker-content';
import { DatePickerRoot } from './date-picker-root';
import { DatePickerTrigger } from './date-picker-trigger';

function DatePickerHiddenInput({ name }: { name: string }) {
  const { dateFormat, mode, selectedDate } = useDatePickerContext();
  const value = selectedDate ? formatPickerDate(selectedDate, mode, dateFormat) : '';

  return (
    <input aria-hidden className="hts-control-hidden" name={name} type="hidden" value={value} />
  );
}

export function BaseDatePicker({
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  autoFocus,
  disabled,
  id,
  name,
  onBlur,
  onClick,
  onFocus,
  onKeyDown,
  placeholder,
  tabIndex,
  title,
  ...rootProps
}: BaseDatePickerProps) {
  return (
    <DatePickerRoot {...rootProps} disabled={disabled} placeholder={placeholder}>
      {name ? <DatePickerHiddenInput name={name} /> : null}
      <DatePickerTrigger
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        autoFocus={autoFocus}
        id={id}
        onBlur={onBlur}
        onClick={onClick}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        tabIndex={tabIndex}
        title={title}
      />
      <DatePickerContent>
        <DatePickerCalendar />
      </DatePickerContent>
    </DatePickerRoot>
  );
}

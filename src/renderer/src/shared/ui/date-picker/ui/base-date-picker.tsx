import type { ReactElement } from 'react';
import { DateInput, useDatePickerContext } from '../../date-input';
import type { DatePickerProps } from '../model/types';
import { DatePickerContent } from './date-picker-content';
import { DatePickerTrigger } from './date-picker-trigger';

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const DatePickerHiddenInput = ({ name }: { name: string }): ReactElement => {
  const context = useDatePickerContext('DatePicker.HiddenInput');

  return (
    <input
      aria-hidden
      className="hts-control-hidden"
      name={name}
      type="hidden"
      value={context.value}
    />
  );
};

export function BaseDatePicker({
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  autoFocus,
  className,
  defaultOpen,
  defaultValue,
  dense = false,
  disabled,
  id,
  max,
  min,
  name,
  onBlur,
  onChange,
  onClick,
  onFocus,
  onKeyDown,
  onOpenChange,
  open,
  placeholder,
  style,
  tabIndex,
  title,
  value,
}: DatePickerProps): ReactElement {
  return (
    <DateInput.Root
      className={joinClasses('hts-date-picker', className)}
      defaultOpen={defaultOpen}
      defaultValue={defaultValue}
      dense={dense}
      disabled={disabled}
      max={max}
      min={min}
      onOpenChange={onOpenChange}
      onValueChange={onChange}
      open={open}
      style={style}
      value={value}
    >
      {name ? <DatePickerHiddenInput name={name} /> : null}
      <DatePickerTrigger
        autoFocus={autoFocus}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        id={id}
        placeholder={placeholder}
        tabIndex={tabIndex}
        title={title}
        onBlur={onBlur}
        onClick={onClick}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      <DatePickerContent>
        <DateInput.Calendar />
      </DatePickerContent>
    </DateInput.Root>
  );
}

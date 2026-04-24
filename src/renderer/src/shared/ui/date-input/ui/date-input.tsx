import type { ReactElement } from 'react';
import { createSyntheticDateChangeEvent } from '../lib/date-input-values';
import type { DateInputProps } from '../model/types';
import { DateInputCalendar } from './date-input-calendar';
import { DateInputContent } from './date-input-content';
import { DateInputField } from './date-input-field';
import { DateInputRoot } from './date-input-root';
import { DateInputTrigger } from './date-input-trigger';

const DateInputAdapter = ({
  autoFocus,
  className,
  defaultValue,
  dense = false,
  disabled,
  id,
  invalid = false,
  max,
  min,
  name,
  onBlur,
  onChange,
  onFocus,
  placeholder,
  required,
  style,
  title,
  value,
  ...props
}: DateInputProps): ReactElement => {
  return (
    <DateInputRoot
      className={className}
      defaultValue={defaultValue}
      dense={dense}
      disabled={disabled}
      invalid={invalid}
      max={typeof max === 'number' ? String(max) : max}
      min={typeof min === 'number' ? String(min) : min}
      onValueChange={(nextValue) => {
        onChange?.(createSyntheticDateChangeEvent(nextValue, name));
      }}
      style={style}
      value={value}
    >
      <DateInputField
        {...props}
        autoFocus={autoFocus}
        id={id}
        name={name}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        required={required}
        title={title}
      />
      <DateInputTrigger />
      <DateInputContent>
        <DateInputCalendar />
      </DateInputContent>
    </DateInputRoot>
  );
};

type DateInputComponent = ((props: DateInputProps) => ReactElement) & {
  Calendar: typeof DateInputCalendar;
  Content: typeof DateInputContent;
  Field: typeof DateInputField;
  Root: typeof DateInputRoot;
  Trigger: typeof DateInputTrigger;
};

export const DateInput = Object.assign(DateInputAdapter, {
  Calendar: DateInputCalendar,
  Content: DateInputContent,
  Field: DateInputField,
  Root: DateInputRoot,
  Trigger: DateInputTrigger,
}) as DateInputComponent;

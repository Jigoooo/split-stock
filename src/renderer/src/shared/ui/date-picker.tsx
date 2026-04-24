import { CalendarDays, ChevronDown } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  FocusEventHandler,
  KeyboardEventHandler,
  ReactElement,
  ReactNode,
} from 'react';
import { memo } from 'react';
import { DateInput, type DateInputRootProps, useDatePickerContext } from './date-input';

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type DatePickerRootProps = DateInputRootProps;

export interface DatePickerValueProps {
  placeholder?: ReactNode;
}

const DatePickerValue = memo(
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

export interface DatePickerTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
  placeholder?: ReactNode;
}

const DatePickerTrigger = memo(
  ({ children, className, placeholder = '날짜 선택', ...props }: DatePickerTriggerProps) => {
    return (
      <DateInput.Trigger {...props} className={joinClasses('hts-date-picker__trigger', className)}>
        <span className="hts-date-picker__label-wrap">
          <span className="hts-date-picker__leading" aria-hidden>
            <CalendarDays size={14} />
          </span>
          {children ?? <DatePickerValue placeholder={placeholder} />}
        </span>
        <span className="hts-date-picker__icon" aria-hidden>
          <ChevronDown size={14} />
        </span>
      </DateInput.Trigger>
    );
  },
);

DatePickerTrigger.displayName = 'DatePickerTrigger';

const DatePickerHiddenInput = memo(({ name }: { name: string }): ReactElement => {
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
});

DatePickerHiddenInput.displayName = 'DatePickerHiddenInput';

export interface DatePickerProps
  extends Omit<DateInputRootProps, 'children' | 'invalid' | 'onValueChange'> {
  'aria-describedby'?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  autoFocus?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  onBlur?: FocusEventHandler<HTMLButtonElement> | undefined;
  onChange?: ((nextValue: string) => void) | undefined;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  onFocus?: FocusEventHandler<HTMLButtonElement> | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement> | undefined;
  placeholder?: ReactNode;
  tabIndex?: number | undefined;
  title?: string | undefined;
}

const DatePickerAdapter = ({
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
}: DatePickerProps): ReactElement => {
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
      <DateInput.Content>
        <DateInput.Calendar />
      </DateInput.Content>
    </DateInput.Root>
  );
};

type DatePickerComponent = ((props: DatePickerProps) => ReactElement) & {
  Calendar: typeof DateInput.Calendar;
  Content: typeof DateInput.Content;
  Root: typeof DateInput.Root;
  Trigger: typeof DatePickerTrigger;
  Value: typeof DatePickerValue;
};

export const DatePicker = Object.assign(DatePickerAdapter, {
  Calendar: DateInput.Calendar,
  Content: DateInput.Content,
  Root: DateInput.Root,
  Trigger: DatePickerTrigger,
  Value: DatePickerValue,
}) as DatePickerComponent;

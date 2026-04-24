import type {
  ButtonHTMLAttributes,
  CSSProperties,
  FocusEventHandler,
  HTMLProps,
  KeyboardEventHandler,
  ReactNode,
} from 'react';

export type DatePickerMode = 'year' | 'month' | 'day';

export type DatePickerProps = {
  'aria-describedby'?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  onBlur?: FocusEventHandler<HTMLButtonElement> | undefined;
  mode?: DatePickerMode;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  onFocus?: FocusEventHandler<HTMLButtonElement> | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement> | undefined;
  min?: string | undefined;
  max?: string | undefined;
  dateFormat?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  style?: CSSProperties | undefined;
  tabIndex?: number | undefined;
  title?: string | undefined;
};

export type BaseDatePickerProps = DatePickerProps;

export type DatePickerRootProps = DatePickerProps & {
  children: ReactNode;
};

export type DatePickerTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'disabled' | 'type'
> & {
  placeholder?: string | undefined;
  style?: CSSProperties | undefined;
};

export type DatePickerContentProps = {
  children: ReactNode;
  style?: CSSProperties;
};

export type CalendarDay = {
  date: Date;
  isCurrentMonth: boolean;
  isDisabled: boolean;
};

export type DatePickerContextValue = {
  mode: DatePickerMode;
  dateFormat?: string | undefined;
  disabled: boolean;
  placeholder: string;
  isOpen: boolean;
  setIsOpen: (next: boolean) => void;
  selectedDate: Date | null;
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  displayMode: DatePickerMode;
  setDisplayMode: (mode: DatePickerMode) => void;
  minDate: Date | null;
  maxDate: Date | null;
  placement: string;
  commitSelection: (date: Date) => void;
  setReference: (node: HTMLElement | null) => void;
  setFloating: (node: HTMLElement | null) => void;
  floatingStyles: CSSProperties;
  getReferenceProps: (userProps?: HTMLProps<HTMLElement>) => Record<string, unknown>;
  getFloatingProps: (userProps?: HTMLProps<HTMLElement>) => Record<string, unknown>;
};

export type UseDatePickerReturn = {
  selectedDate: Date | null;
  isOpen: boolean;
  setIsOpen: (next: boolean) => void;
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  displayMode: DatePickerMode;
  setDisplayMode: (mode: DatePickerMode) => void;
  minDate: Date | null;
  maxDate: Date | null;
  commitSelection: (date: Date) => void;
};

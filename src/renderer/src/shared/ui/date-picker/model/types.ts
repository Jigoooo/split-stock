import type {
  ButtonHTMLAttributes,
  FocusEventHandler,
  KeyboardEventHandler,
  ReactNode,
} from 'react';
import type { DateInputRootProps } from '../../date-input';

export type DatePickerRootProps = DateInputRootProps;

export interface DatePickerValueProps {
  placeholder?: ReactNode;
}

export interface DatePickerTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
  placeholder?: ReactNode;
}

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

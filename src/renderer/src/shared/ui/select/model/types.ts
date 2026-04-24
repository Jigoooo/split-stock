import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  FocusEventHandler,
  ReactNode,
  RefObject,
  SelectHTMLAttributes,
} from 'react';

export interface SelectOptionMeta {
  disabled: boolean;
  id: string;
  label: ReactNode;
  value: string;
}

export interface SelectOptionLookup {
  byValue: Map<string, SelectOptionMeta>;
  enabledIndexByValue: Map<string, number>;
  enabledValues: string[];
  indexByValue: Map<string, number>;
}

export interface SelectContextValue {
  activeValue: string;
  dense: boolean;
  disabled: boolean;
  listboxId: string;
  optionLookup: SelectOptionLookup;
  optionSnapshot?: SelectOptionMeta[] | undefined;
  open: boolean;
  options: SelectOptionMeta[];
  registerOption: (meta: SelectOptionMeta) => void;
  selectValue: (value: string, shouldRestoreFocus: boolean) => void;
  setActiveValue: (value: string) => void;
  setOpen: (open: boolean) => void;
  setOpenAndRestore: (open: boolean, shouldRestoreFocus: boolean) => void;
  syncActiveToBoundary: (boundary: 'first' | 'last') => void;
  syncActiveToCurrent: () => void;
  stepActiveValue: (direction: 1 | -1) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  unregisterOption: (value: string) => void;
  value: string;
}

export interface SelectRootProps {
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  defaultValue?: string | undefined;
  dense?: boolean | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  optionSnapshot?: SelectOptionMeta[] | undefined;
  onValueChange?: ((nextValue: string) => void) | undefined;
  open?: boolean | undefined;
  value?: string | undefined;
}

export interface SelectTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'value'> {
  children?: ReactNode;
}

export interface SelectValueProps {
  placeholder?: ReactNode;
}

export interface SelectContentProps {
  children?: ReactNode | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export interface SelectOptionProps {
  children: ReactNode;
  disabled?: boolean;
  value: string;
}

export interface SelectOptionRowProps {
  dense: boolean;
  disabled: boolean;
  id: string;
  isActive: boolean;
  isSelected: boolean;
  label: ReactNode;
  onActivate: (value: string) => void;
  onSelect: (value: string, shouldRestoreFocus: boolean) => void;
  value: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  'data-testid'?: string | undefined;
  children?: ReactNode | undefined;
  dense?: boolean | undefined;
  placeholder?: ReactNode | undefined;
}

export type SelectTriggerClickHandler = ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
export type SelectTriggerKeyDownHandler = ButtonHTMLAttributes<HTMLButtonElement>['onKeyDown'];
export type SelectTriggerFocusHandler = FocusEventHandler<HTMLButtonElement> | undefined;
export type SelectChangeHandler = ((event: ChangeEvent<HTMLSelectElement>) => void) | undefined;

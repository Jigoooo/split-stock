import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  RefObject,
} from 'react';

export type DateViewMode = 'day' | 'month' | 'year';
export type DismissReason = 'escape' | 'outside-pointer';
export type DateSegmentName = 'year' | 'month' | 'day';

export interface CalendarDateParts {
  day: number;
  month: number;
  year: number;
}

export interface DateDraftParts {
  day: string;
  month: string;
  year: string;
}

export interface DateInputFieldContextValue {
  commitDraft: (options?: { restoreFocus?: boolean; shouldClose?: boolean }) => void;
  disabled: boolean;
  dismissPopup: (reason: DismissReason) => void;
  draftParts: DateDraftParts;
  focusSegment: (segment: DateSegmentName) => void;
  inputId: string;
  inputRefs: Record<DateSegmentName, RefObject<HTMLInputElement | null>>;
  open: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLSpanElement | null>;
  setActiveSegment: (segment: DateSegmentName) => void;
  setDraftPart: (segment: DateSegmentName, nextDraft: string) => void;
  value: string;
}

export interface DateInputPopupContextValue {
  closeCalendar: (shouldRestoreFocus: boolean) => void;
  commitDraft: (options?: { restoreFocus?: boolean; shouldClose?: boolean }) => void;
  commitValue: (
    nextValue: string,
    options?: { restoreFocus?: boolean; shouldClose?: boolean },
  ) => void;
  dense: boolean;
  disabled: boolean;
  dismissPopup: (reason: DismissReason) => void;
  inputId: string;
  max: string | undefined;
  min: string | undefined;
  open: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLSpanElement | null>;
  setOpen: (nextOpen: boolean) => void;
  setViewMode: (nextMode: DateViewMode) => void;
  setVisibleMonth: (nextMonth: Date) => void;
  value: string;
  viewMode: DateViewMode;
  visibleMonth: Date;
  yearPageStart: number;
  shiftVisibleMonth: (offset: number) => void;
  shiftYearPage: (offset: number) => void;
}

export interface DateInputRootProps {
  children: ReactNode;
  className?: string | undefined;
  defaultOpen?: boolean | undefined;
  defaultValue?: string | undefined;
  dense?: boolean | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  max?: string | undefined;
  min?: string | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onValueChange?: ((nextValue: string) => void) | undefined;
  open?: boolean | undefined;
  style?: CSSProperties | undefined;
  value?: string | undefined;
}

export interface DateInputFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'onChange' | 'type' | 'value'
  > {}

export interface DateInputTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
}

export interface DateInputContentProps {
  children: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export interface DateInputCalendarProps {
  className?: string | undefined;
}

type NativeDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'onChange' | 'type' | 'value'
>;

export interface DateInputProps extends NativeDateInputProps {
  defaultValue?: string | undefined;
  dense?: boolean | undefined;
  invalid?: boolean | undefined;
  onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  value?: string | undefined;
}

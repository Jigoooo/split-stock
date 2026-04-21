import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  FocusEventHandler,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { ControlPopup } from './control-popup';

type DateViewMode = 'day' | 'month' | 'year';
type DismissReason = 'escape' | 'outside-pointer';

interface CalendarDateParts {
  day: number;
  month: number;
  year: number;
}

interface DateInputContextValue {
  closeCalendar: (shouldRestoreFocus: boolean) => void;
  commitDraft: (options?: { restoreFocus?: boolean; shouldClose?: boolean }) => void;
  commitValue: (
    nextValue: string,
    options?: { restoreFocus?: boolean; shouldClose?: boolean },
  ) => void;
  dense: boolean;
  disabled: boolean;
  dismissPopup: (reason: DismissReason) => void;
  draft: string;
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  invalid: boolean;
  max: string | undefined;
  min: string | undefined;
  open: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLSpanElement | null>;
  setDraft: (nextDraft: string) => void;
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

const DateInputContext = createContext<DateInputContextValue | null>(null);
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function useDateInputContext(component: string): DateInputContextValue {
  const context = useContext(DateInputContext);
  if (!context) {
    throw new Error(`${component} must be used within DateInput.Root`);
  }
  return context;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toIsoDate(parts: CalendarDateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseCanonicalIso(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;

  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;

  return { day, month, year };
}

function parseRecoverableDraft(value: string): CalendarDateParts | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (/^\d{8}$/.test(digitsOnly)) {
    return {
      day: Number(digitsOnly.slice(6, 8)),
      month: Number(digitsOnly.slice(4, 6)),
      year: Number(digitsOnly.slice(0, 4)),
    };
  }

  const compactMatch = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/.exec(trimmed);
  if (!compactMatch) return null;

  return {
    day: Number(compactMatch[3]),
    month: Number(compactMatch[2]),
    year: Number(compactMatch[1]),
  };
}

function clampPartsToValidDate(parts: CalendarDateParts): CalendarDateParts {
  const month = Math.min(12, Math.max(1, parts.month));
  const day = Math.min(getDaysInMonth(parts.year, month), Math.max(1, parts.day));
  return {
    day,
    month,
    year: parts.year,
  };
}

function clampIsoToBounds(value: string, min?: string, max?: string): string {
  let next = value;
  if (min && next < min) {
    next = min;
  }
  if (max && next > max) {
    next = max;
  }
  return next;
}

function normalizeDraftValue(
  draft: string,
  committedValue: string,
  min?: string,
  max?: string,
): string {
  const trimmed = draft.trim();
  if (trimmed === '') return '';

  const recoverable = parseRecoverableDraft(trimmed);
  if (!recoverable) {
    return committedValue;
  }

  return clampIsoToBounds(toIsoDate(clampPartsToValidDate(recoverable)), min, max);
}

function toCalendarMonth(value: string): Date {
  const parts = parseCanonicalIso(value);
  if (parts) {
    return new Date(parts.year, parts.month - 1, 1);
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getYearPageStart(year: number): number {
  return Math.floor(year / 12) * 12;
}

function buildCalendarDays(visibleMonth: Date): Array<{ inCurrentMonth: boolean; iso: string }> {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const days: Array<{ inCurrentMonth: boolean; iso: string }> = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, index - firstWeekday + 1);
    days.push({
      inCurrentMonth: date.getMonth() === month,
      iso: toIsoDate({
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      }),
    });
  }

  return days;
}

function isFocusableTarget(node: Node | null, ...containers: Array<HTMLElement | null>): boolean {
  return containers.some((container) => container?.contains(node ?? null));
}

function createSyntheticDateChangeEvent(
  nextValue: string,
  name: string | undefined,
): ChangeEvent<HTMLInputElement> {
  const target = {
    name,
    value: nextValue,
  };

  return {
    bubbles: true,
    cancelable: false,
    currentTarget: target,
    defaultPrevented: false,
    eventPhase: 3,
    isTrusted: false,
    nativeEvent: new Event('change'),
    persist: () => undefined,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    target,
    timeStamp: Date.now(),
    type: 'change',
  } as unknown as ChangeEvent<HTMLInputElement>;
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

const DateInputRoot = ({
  children,
  className,
  defaultOpen = false,
  defaultValue = '',
  dense = false,
  disabled = false,
  invalid = false,
  max,
  min,
  onOpenChange,
  onValueChange,
  open,
  style,
  value,
}: DateInputRootProps): ReactElement => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(value ?? defaultValue);
  const [visibleMonth, setVisibleMonth] = useState(() => toCalendarMonth(value ?? defaultValue));
  const [viewMode, setViewMode] = useState<DateViewMode>('day');
  const [yearPageStart, setYearPageStart] = useState(() =>
    getYearPageStart(toCalendarMonth(value ?? defaultValue).getFullYear()),
  );
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const currentValue = value ?? internalValue;
  const isOpen = open ?? internalOpen;

  const applyOpenChange = (nextOpen: boolean): void => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const closeCalendar = (shouldRestoreFocus: boolean): void => {
    applyOpenChange(false);
    setViewMode('day');

    if (!shouldRestoreFocus) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const commitValue = useEffectEvent(
    (nextValue: string, options?: { restoreFocus?: boolean; shouldClose?: boolean }) => {
      if (nextValue !== currentValue) {
        if (value === undefined) {
          setInternalValue(nextValue);
        }
        onValueChange?.(nextValue);
      }

      setDraft(nextValue);
      setVisibleMonth(toCalendarMonth(nextValue));
      setYearPageStart(getYearPageStart(toCalendarMonth(nextValue).getFullYear()));

      if (options?.shouldClose) {
        closeCalendar(Boolean(options.restoreFocus));
      }
    },
  );

  const commitDraft = useEffectEvent(
    (options?: { restoreFocus?: boolean; shouldClose?: boolean }) => {
      const normalized = normalizeDraftValue(draft, currentValue, min, max);
      commitValue(normalized, options);
    },
  );

  const dismissPopup = useEffectEvent((reason: DismissReason) => {
    if (reason === 'escape') {
      setDraft(currentValue);
      closeCalendar(true);
      return;
    }

    if (document.activeElement === inputRef.current) {
      closeCalendar(false);
      return;
    }

    commitDraft({ shouldClose: true });
  });

  const shiftVisibleMonth = useEffectEvent((offset: number) => {
    setVisibleMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + offset, 1);
      setYearPageStart(getYearPageStart(next.getFullYear()));
      return next;
    });
  });

  const shiftYearPage = useEffectEvent((offset: number) => {
    setYearPageStart((prev) => prev + offset);
  });

  useEffect(() => {
    if (value === undefined) return;
    setDraft(value);
    setVisibleMonth(toCalendarMonth(value));
    setYearPageStart(getYearPageStart(toCalendarMonth(value).getFullYear()));
  }, [value]);

  const contextValue: DateInputContextValue = {
    closeCalendar,
    commitDraft,
    commitValue,
    dense,
    disabled,
    dismissPopup,
    draft,
    inputId,
    inputRef,
    invalid,
    max,
    min,
    open: isOpen,
    popupRef,
    rootRef,
    setDraft,
    setOpen: applyOpenChange,
    setViewMode,
    setVisibleMonth,
    shiftVisibleMonth,
    shiftYearPage,
    value: currentValue,
    viewMode,
    visibleMonth,
    yearPageStart,
  };

  return (
    <DateInputContext.Provider value={contextValue}>
      <span
        ref={rootRef}
        className={joinClasses(
          'hts-date-root',
          'hts-date-input',
          'hts-date-shell',
          dense && 'hts-date-input--dense',
          disabled && 'hts-date-shell--disabled',
          invalid && 'hts-date-shell--invalid',
          className,
        )}
        style={style}
      >
        {children}
      </span>
    </DateInputContext.Provider>
  );
};

export interface DateInputFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'onChange' | 'type' | 'value'
  > {}

const DateInputField = ({
  autoFocus,
  className,
  id,
  name,
  onBlur,
  onFocus,
  onKeyDown,
  placeholder = 'YYYY-MM-DD',
  required,
  title,
  ...props
}: DateInputFieldProps): ReactElement => {
  const context = useDateInputContext('DateInput.Field');

  useEffect(() => {
    if (!autoFocus) return;
    context.inputRef.current?.focus();
  }, [autoFocus, context.inputRef]);

  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    onBlur?.(event);
    if (isFocusableTarget(event.relatedTarget, context.rootRef.current, context.popupRef.current)) {
      return;
    }

    context.commitDraft({ shouldClose: context.open });
  };

  return (
    <input
      {...props}
      ref={context.inputRef}
      className={joinClasses('hts-date-input__field', className)}
      disabled={context.disabled}
      id={id ?? context.inputId}
      inputMode="numeric"
      name={name}
      placeholder={placeholder}
      required={required}
      title={title}
      type="text"
      value={context.draft}
      onBlur={handleBlur}
      onChange={(event) => {
        context.setDraft(event.target.value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        if (event.key === 'Enter') {
          event.preventDefault();
          context.commitDraft({ shouldClose: true });
          return;
        }

        if (event.key === 'Escape' && context.open) {
          event.preventDefault();
          context.dismissPopup('escape');
        }
      }}
    />
  );
};

export interface DateInputTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
}

const DateInputTrigger = ({
  'aria-label': ariaLabel,
  className,
  onClick,
  title = '날짜 선택기 열기',
  ...props
}: DateInputTriggerProps): ReactElement => {
  const context = useDateInputContext('DateInput.Trigger');

  return (
    <button
      {...props}
      className={joinClasses('hts-date-shell__trigger', className)}
      disabled={context.disabled}
      title={title}
      type="button"
      aria-label={ariaLabel ?? '날짜 선택기 열기'}
      aria-controls={`${context.inputId}-calendar`}
      aria-expanded={context.open}
      aria-haspopup="dialog"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || context.disabled) return;

        if (context.open) {
          context.setOpen(false);
          return;
        }

        context.setVisibleMonth(toCalendarMonth(context.value || context.draft));
        context.setViewMode('day');
        context.setOpen(true);
      }}
    >
      {props.children ?? <CalendarDays size={15} aria-hidden />}
    </button>
  );
};

export interface DateInputContentProps {
  children: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

const DateInputContent = ({ children, className, style }: DateInputContentProps): ReactElement => {
  const context = useDateInputContext('DateInput.Content');

  return (
    <ControlPopup
      anchorRef={context.rootRef}
      className={joinClasses('hts-control-popup', 'hts-control-popup--date', className)}
      id={`${context.inputId}-calendar`}
      onDismiss={(reason) => context.dismissPopup(reason)}
      open={context.open}
      popupRef={context.popupRef}
      role="dialog"
      style={style}
      widthMode="content"
      minWidth={296}
    >
      {children}
    </ControlPopup>
  );
};

export interface DateInputCalendarProps {
  className?: string | undefined;
}

const DateInputCalendar = ({ className }: DateInputCalendarProps): ReactElement => {
  const context = useDateInputContext('DateInput.Calendar');
  const year = context.visibleMonth.getFullYear();
  const month = context.visibleMonth.getMonth();
  const calendarDays = buildCalendarDays(context.visibleMonth);
  const todayIso = toIsoDate({
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  });

  const handlePrev = (): void => {
    if (context.viewMode === 'year') {
      context.shiftYearPage(-12);
      return;
    }

    if (context.viewMode === 'month') {
      context.setVisibleMonth(new Date(year - 1, month, 1));
      return;
    }

    context.shiftVisibleMonth(-1);
  };

  const handleNext = (): void => {
    if (context.viewMode === 'year') {
      context.shiftYearPage(12);
      return;
    }

    if (context.viewMode === 'month') {
      context.setVisibleMonth(new Date(year + 1, month, 1));
      return;
    }

    context.shiftVisibleMonth(1);
  };

  return (
    <div className={joinClasses('hts-date-popup', className)}>
      <div className="hts-date-popup__header">
        <button
          className="hts-date-popup__nav"
          type="button"
          aria-label={
            context.viewMode === 'year'
              ? '이전 연도 묶음'
              : context.viewMode === 'month'
                ? '이전 연도'
                : '이전 달'
          }
          onClick={handlePrev}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        <div className="hts-date-popup__selectors">
          <button
            className={joinClasses(
              'hts-date-popup__selector',
              context.viewMode === 'year' && 'hts-date-popup__selector--active',
            )}
            type="button"
            aria-label="연도 선택 열기"
            onClick={() => {
              context.setViewMode(context.viewMode === 'year' ? 'day' : 'year');
            }}
          >
            <span>{year}년</span>
            <ChevronDown size={13} aria-hidden />
          </button>
          <button
            className={joinClasses(
              'hts-date-popup__selector',
              context.viewMode === 'month' && 'hts-date-popup__selector--active',
            )}
            type="button"
            aria-label="월 선택 열기"
            onClick={() => {
              context.setViewMode(context.viewMode === 'month' ? 'day' : 'month');
            }}
          >
            <span>{month + 1}월</span>
            <ChevronDown size={13} aria-hidden />
          </button>
        </div>
        <button
          className="hts-date-popup__nav"
          type="button"
          aria-label={
            context.viewMode === 'year'
              ? '다음 연도 묶음'
              : context.viewMode === 'month'
                ? '다음 연도'
                : '다음 달'
          }
          onClick={handleNext}
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {context.viewMode === 'year' ? (
        <div className="hts-date-popup__year-grid">
          {Array.from({ length: 12 }, (_, index) => context.yearPageStart + index).map(
            (gridYear) => (
              <button
                key={gridYear}
                aria-label={`${gridYear}년 선택`}
                className={joinClasses(
                  'hts-date-popup__month-cell',
                  gridYear === year && 'hts-date-popup__month-cell--selected',
                )}
                type="button"
                onClick={() => {
                  context.setVisibleMonth(new Date(gridYear, month, 1));
                  context.setViewMode('day');
                }}
              >
                {gridYear}
              </button>
            ),
          )}
        </div>
      ) : null}

      {context.viewMode === 'month' ? (
        <div className="hts-date-popup__month-grid">
          {Array.from({ length: 12 }, (_, monthIndex) => monthIndex).map((monthIndex) => (
            <button
              key={monthIndex}
              aria-label={`${monthIndex + 1}월 선택`}
              className={joinClasses(
                'hts-date-popup__month-cell',
                monthIndex === month && 'hts-date-popup__month-cell--selected',
              )}
              type="button"
              onClick={() => {
                context.setVisibleMonth(new Date(year, monthIndex, 1));
                context.setViewMode('day');
              }}
            >
              {monthIndex + 1}월
            </button>
          ))}
        </div>
      ) : null}

      {context.viewMode === 'day' ? (
        <>
          <div className="hts-date-popup__weekdays">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="hts-date-popup__weekday">
                {label}
              </span>
            ))}
          </div>
          <div className="hts-date-popup__days">
            {calendarDays.map((dayItem) => {
              const dayParts = parseCanonicalIso(dayItem.iso);
              const isDisabled =
                (context.min !== undefined && dayItem.iso < context.min) ||
                (context.max !== undefined && dayItem.iso > context.max);
              const isSelected = context.value === dayItem.iso;
              const isToday = dayItem.iso === todayIso;

              return (
                <button
                  key={dayItem.iso}
                  aria-label={`${dayItem.iso} 선택`}
                  className={joinClasses(
                    'hts-date-popup__day',
                    !dayItem.inCurrentMonth && 'hts-date-popup__day--adjacent',
                    isSelected && 'hts-date-popup__day--selected',
                    isToday && 'hts-date-popup__day--today',
                    isDisabled && 'hts-date-popup__day--disabled',
                  )}
                  disabled={isDisabled}
                  type="button"
                  onClick={() => {
                    context.commitValue(dayItem.iso, {
                      restoreFocus: true,
                      shouldClose: true,
                    });
                  }}
                >
                  {dayParts?.day ?? ''}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
};

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

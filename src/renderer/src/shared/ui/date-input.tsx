import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  FocusEvent,
  FocusEventHandler,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactElement,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import {
  createContext,
  Fragment,
  memo,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ControlPopup } from './control-popup';

type DateViewMode = 'day' | 'month' | 'year';
type DismissReason = 'escape' | 'outside-pointer';
type DateSegmentName = 'year' | 'month' | 'day';

interface CalendarDateParts {
  day: number;
  month: number;
  year: number;
}

interface DateDraftParts {
  day: string;
  month: string;
  year: string;
}

interface DateInputFieldContextValue {
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

interface DateInputPopupContextValue {
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

const DateInputFieldContext = createContext<DateInputFieldContextValue | null>(null);
const DateInputPopupContext = createContext<DateInputPopupContextValue | null>(null);
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const DATE_SEGMENT_ORDER = [
  'year',
  'month',
  'day',
] as const satisfies ReadonlyArray<DateSegmentName>;
const YEAR_PAGE_SIZE = 12;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, monthIndex) => monthIndex);
const DATE_SEGMENT_LENGTH: Record<DateSegmentName, number> = {
  day: 2,
  month: 2,
  year: 4,
};
const DATE_SEGMENT_PLACEHOLDER: Record<DateSegmentName, string> = {
  day: 'DD',
  month: 'MM',
  year: 'YYYY',
};
const DATE_SEGMENT_SUFFIX: Record<DateSegmentName, string> = {
  day: '일',
  month: '월',
  year: '연도',
};

function useDateInputFieldContext(component: string): DateInputFieldContextValue {
  const context = useContext(DateInputFieldContext);
  if (!context) {
    throw new Error(`${component} must be used within DateInput.Root`);
  }
  return context;
}

function useDateInputPopupContext(component: string): DateInputPopupContextValue {
  const context = useContext(DateInputPopupContext);
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

function emptyDraftParts(): DateDraftParts {
  return {
    day: '',
    month: '',
    year: '',
  };
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

function sanitizeSegmentDraft(value: string, segment: DateSegmentName): string {
  return value.replace(/\D/g, '').slice(0, DATE_SEGMENT_LENGTH[segment]);
}

function toDraftParts(value: string): DateDraftParts {
  const trimmed = value.trim();
  if (trimmed === '') return emptyDraftParts();

  const canonical = parseCanonicalIso(trimmed);
  if (canonical) {
    return {
      day: pad2(canonical.day),
      month: pad2(canonical.month),
      year: String(canonical.year).padStart(4, '0'),
    };
  }

  const recoverable = parseRecoverableDraft(trimmed);
  if (!recoverable) return emptyDraftParts();

  return {
    day: sanitizeSegmentDraft(String(recoverable.day), 'day'),
    month: sanitizeSegmentDraft(String(recoverable.month), 'month'),
    year: sanitizeSegmentDraft(String(recoverable.year), 'year'),
  };
}

function normalizeDraftParts(
  draftParts: DateDraftParts,
  committedValue: string,
  min?: string,
  max?: string,
): string {
  if (
    draftParts.year.trim() === '' &&
    draftParts.month.trim() === '' &&
    draftParts.day.trim() === ''
  ) {
    return '';
  }

  return normalizeDraftValue(
    `${draftParts.year}-${draftParts.month}-${draftParts.day}`,
    committedValue,
    min,
    max,
  );
}

function hasDraftPartsValue(draftParts: DateDraftParts): boolean {
  return (
    draftParts.year.trim() !== '' || draftParts.month.trim() !== '' || draftParts.day.trim() !== ''
  );
}

function getAdjacentSegment(segment: DateSegmentName, offset: -1 | 1): DateSegmentName | null {
  const nextIndex = DATE_SEGMENT_ORDER.indexOf(segment) + offset;
  return DATE_SEGMENT_ORDER[nextIndex] ?? null;
}

function createSegmentLabel(label: string | undefined, segment: DateSegmentName): string {
  const suffix = DATE_SEGMENT_SUFFIX[segment];
  return label ? `${label} ${suffix}` : suffix;
}

function findSegmentFromTarget(
  target: EventTarget | null,
  inputRefs: Record<DateSegmentName, RefObject<HTMLInputElement | null>>,
): DateSegmentName | null {
  return DATE_SEGMENT_ORDER.find((segment) => inputRefs[segment].current === target) ?? null;
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

function canSelectRange(startIso: string, endIso: string, min?: string, max?: string): boolean {
  if (min !== undefined && endIso < min) return false;
  if (max !== undefined && startIso > max) return false;
  return true;
}

function canSelectMonth(year: number, monthIndex: number, min?: string, max?: string): boolean {
  const month = monthIndex + 1;
  return canSelectRange(
    toIsoDate({ day: 1, month, year }),
    toIsoDate({ day: getDaysInMonth(year, month), month, year }),
    min,
    max,
  );
}

function canSelectYear(year: number, min?: string, max?: string): boolean {
  return canSelectRange(
    toIsoDate({ day: 1, month: 1, year }),
    toIsoDate({ day: 31, month: 12, year }),
    min,
    max,
  );
}

function canSelectYearPage(yearPageStart: number, min?: string, max?: string): boolean {
  return Array.from({ length: YEAR_PAGE_SIZE }, (_, index) => yearPageStart + index).some((year) =>
    canSelectYear(year, min, max),
  );
}

interface CalendarDayCell {
  dayLabel: number;
  inCurrentMonth: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  isToday: boolean;
  iso: string;
}

function buildCalendarDays(
  visibleMonth: Date,
): Array<{ dayLabel: number; inCurrentMonth: boolean; iso: string }> {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const days: Array<{ dayLabel: number; inCurrentMonth: boolean; iso: string }> = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month, index - firstWeekday + 1);
    days.push({
      dayLabel: date.getDate(),
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

function getTodayIso(now: Date = new Date()): string {
  return toIsoDate({
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
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
  const [draftParts, setDraftParts] = useState(() => toDraftParts(value ?? defaultValue));
  const [visibleMonth, setVisibleMonth] = useState(() => toCalendarMonth(value ?? defaultValue));
  const [viewMode, setViewMode] = useState<DateViewMode>('day');
  const [yearPageStart, setYearPageStart] = useState(() =>
    getYearPageStart(toCalendarMonth(value ?? defaultValue).getFullYear()),
  );
  const rootRef = useRef<HTMLSpanElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const dayInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const lastFocusedSegmentRef = useRef<DateSegmentName>('year');
  const inputId = useId();
  const inputRefs = useMemo<Record<DateSegmentName, RefObject<HTMLInputElement | null>>>(
    () => ({
      day: dayInputRef,
      month: monthInputRef,
      year: yearInputRef,
    }),
    [],
  );

  const currentValue = value ?? internalValue;
  const isOpen = open ?? internalOpen;

  const applyOpenChange = useEffectEvent((nextOpen: boolean): void => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  });

  const closeCalendar = useEffectEvent((shouldRestoreFocus: boolean): void => {
    applyOpenChange(false);

    if (!shouldRestoreFocus) return;
    window.requestAnimationFrame(() => {
      const segment = lastFocusedSegmentRef.current;
      const target = inputRefs[segment].current ?? yearInputRef.current;
      target?.focus();
      target?.select();
    });
  });

  const commitValue = useEffectEvent(
    (nextValue: string, options?: { restoreFocus?: boolean; shouldClose?: boolean }) => {
      if (nextValue !== currentValue) {
        if (value === undefined) {
          setInternalValue(nextValue);
        }
        onValueChange?.(nextValue);
      }

      setDraftParts(toDraftParts(nextValue));
      if (nextValue !== '') {
        setVisibleMonth(toCalendarMonth(nextValue));
      }

      if (options?.shouldClose) {
        closeCalendar(Boolean(options.restoreFocus));
      }
    },
  );

  const commitDraft = useEffectEvent(
    (options?: { restoreFocus?: boolean; shouldClose?: boolean }) => {
      if (currentValue === '' && hasDraftPartsValue(draftParts)) {
        const recoverable = parseRecoverableDraft(
          `${draftParts.year}-${draftParts.month}-${draftParts.day}`,
        );

        if (!recoverable) {
          if (options?.shouldClose) {
            closeCalendar(Boolean(options.restoreFocus));
          }
          return;
        }
      }

      const normalized = normalizeDraftParts(draftParts, currentValue, min, max);
      commitValue(normalized, options);
    },
  );

  const dismissPopup = useEffectEvent((reason: DismissReason) => {
    if (reason === 'escape') {
      setDraftParts(toDraftParts(currentValue));
      closeCalendar(true);
      return;
    }

    if (
      DATE_SEGMENT_ORDER.some((segment) => document.activeElement === inputRefs[segment].current)
    ) {
      closeCalendar(false);
      return;
    }

    commitDraft({ shouldClose: true });
  });

  const focusSegment = useEffectEvent((segment: DateSegmentName) => {
    lastFocusedSegmentRef.current = segment;
    const target = inputRefs[segment].current;
    if (!target) return;

    window.requestAnimationFrame(() => {
      target.focus();
      target.select();
    });
  });

  const setActiveSegment = useEffectEvent((segment: DateSegmentName) => {
    lastFocusedSegmentRef.current = segment;
  });

  const setDraftPart = useEffectEvent((segment: DateSegmentName, nextDraft: string) => {
    setDraftParts((prev) => ({
      ...prev,
      [segment]: nextDraft,
    }));
  });

  const shiftVisibleMonth = useEffectEvent((offset: number) => {
    setVisibleMonth((prev) => {
      return new Date(prev.getFullYear(), prev.getMonth() + offset, 1);
    });
  });

  const shiftYearPage = useEffectEvent((offset: number) => {
    setYearPageStart((prev) => prev + offset);
  });

  const setViewModeWithPageSync = useEffectEvent((nextMode: DateViewMode) => {
    if (nextMode === 'year') {
      setYearPageStart(getYearPageStart(visibleMonth.getFullYear()));
    }
    setViewMode(nextMode);
  });

  useEffect(() => {
    if (value === undefined) return;
    const nextVisibleMonth = toCalendarMonth(value);
    setDraftParts(toDraftParts(value));
    setVisibleMonth(nextVisibleMonth);
  }, [value]);

  useEffect(() => {
    if (value === undefined || !isOpen || viewMode !== 'year') return;
    const nextVisibleMonth = toCalendarMonth(value);
    if (isOpen && viewMode === 'year') {
      setYearPageStart(getYearPageStart(nextVisibleMonth.getFullYear()));
    }
  }, [isOpen, value, viewMode]);

  const fieldContextValue = useMemo<DateInputFieldContextValue>(
    () => ({
      commitDraft,
      disabled,
      dismissPopup,
      draftParts,
      focusSegment,
      inputId,
      inputRefs,
      open: isOpen,
      popupRef,
      rootRef,
      setActiveSegment,
      setDraftPart,
      value: currentValue,
    }),
    [disabled, draftParts, inputId, inputRefs, isOpen, currentValue],
  );

  const popupContextValue = useMemo<DateInputPopupContextValue>(
    () => ({
      closeCalendar,
      commitDraft,
      commitValue,
      dense,
      disabled,
      dismissPopup,
      inputId,
      max,
      min,
      open: isOpen,
      popupRef,
      rootRef,
      setOpen: applyOpenChange,
      setViewMode: setViewModeWithPageSync,
      setVisibleMonth,
      shiftVisibleMonth,
      shiftYearPage,
      value: currentValue,
      viewMode,
      visibleMonth,
      yearPageStart,
    }),
    [
      dense,
      disabled,
      inputId,
      max,
      min,
      isOpen,
      currentValue,
      viewMode,
      visibleMonth,
      yearPageStart,
    ],
  );

  return (
    <DateInputFieldContext.Provider value={fieldContextValue}>
      <DateInputPopupContext.Provider value={popupContextValue}>
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
      </DateInputPopupContext.Provider>
    </DateInputFieldContext.Provider>
  );
};

export interface DateInputFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'onChange' | 'type' | 'value'
  > {}

const DateInputField = memo(
  ({
    'aria-label': ariaLabel,
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
    const context = useDateInputFieldContext('DateInput.Field');
    const separator = placeholder?.includes('.') ? '.' : '-';

    useEffect(() => {
      if (!autoFocus) return;
      context.focusSegment('year');
    }, [autoFocus, context.focusSegment]);

    const handleBlur =
      (segment: DateSegmentName): FocusEventHandler<HTMLInputElement> =>
      (event) => {
        onBlur?.(event);

        const nextSegment = findSegmentFromTarget(event.relatedTarget, context.inputRefs);
        if (nextSegment) {
          context.commitDraft();
          if (nextSegment !== segment) {
            window.requestAnimationFrame(() => {
              const target = context.inputRefs[nextSegment].current;
              if (target && document.activeElement === target) {
                target.select();
              }
            });
          }
          return;
        }

        if (isFocusableTarget(event.relatedTarget, context.popupRef.current)) {
          return;
        }

        if (isFocusableTarget(event.relatedTarget, context.rootRef.current)) {
          context.commitDraft();
          return;
        }

        context.commitDraft({ shouldClose: context.open });
      };

    const handleKeyDown =
      (segment: DateSegmentName) =>
      (event: KeyboardEvent<HTMLInputElement>): void => {
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
          return;
        }

        if (event.key === '.' || event.key === '-' || event.key === '/') {
          const next = getAdjacentSegment(segment, 1);
          if (!next) return;
          event.preventDefault();
          context.focusSegment(next);
          return;
        }

        if (event.key === 'ArrowLeft') {
          const previous = getAdjacentSegment(segment, -1);
          if (!previous) return;
          event.preventDefault();
          context.focusSegment(previous);
          return;
        }

        if (event.key === 'ArrowRight') {
          const next = getAdjacentSegment(segment, 1);
          if (!next) return;
          event.preventDefault();
          context.focusSegment(next);
          return;
        }

        if (event.key === 'Backspace' && context.draftParts[segment] === '') {
          const previous = getAdjacentSegment(segment, -1);
          if (!previous) return;
          event.preventDefault();
          context.focusSegment(previous);
        }
      };

    const handleChange =
      (segment: DateSegmentName) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        const nextValue = sanitizeSegmentDraft(event.target.value, segment);
        context.setDraftPart(segment, nextValue);

        if (nextValue.length !== DATE_SEGMENT_LENGTH[segment]) return;

        const next = getAdjacentSegment(segment, 1);
        if (next) {
          context.focusSegment(next);
        }
      };

    const handleFocus =
      (segment: DateSegmentName) =>
      (event: FocusEvent<HTMLInputElement>): void => {
        context.setActiveSegment(segment);
        onFocus?.(event);
        const input = event.currentTarget;
        window.requestAnimationFrame(() => {
          if (!input.isConnected) return;
          input.select();
        });
      };

    const handleMouseUp = (event: ReactMouseEvent<HTMLInputElement>): void => {
      event.preventDefault();
    };

    const handlePaste =
      (segment: DateSegmentName) =>
      (event: ClipboardEvent<HTMLInputElement>): void => {
        const pasted = event.clipboardData.getData('text');
        const recoverable = parseRecoverableDraft(pasted);
        if (!recoverable) return;

        event.preventDefault();
        const normalized = clampPartsToValidDate(recoverable);
        context.setDraftPart('year', sanitizeSegmentDraft(String(normalized.year), 'year'));
        context.setDraftPart('month', sanitizeSegmentDraft(String(normalized.month), 'month'));
        context.setDraftPart('day', sanitizeSegmentDraft(String(normalized.day), 'day'));

        const next = getAdjacentSegment(segment, 1) ?? 'day';
        context.focusSegment(next);
      };

    return (
      <fieldset className={joinClasses('hts-date-shell__fields', className)} aria-label={ariaLabel}>
        {name ? <input name={name} readOnly type="hidden" value={context.value} /> : null}
        {DATE_SEGMENT_ORDER.map((segment, index) => (
          <Fragment key={segment}>
            <input
              {...props}
              ref={context.inputRefs[segment]}
              aria-label={createSegmentLabel(ariaLabel, segment)}
              className={joinClasses(
                'hts-date-shell__field',
                'hts-date-shell__field--part',
                `hts-date-shell__field--${segment}`,
              )}
              disabled={context.disabled}
              id={segment === 'year' ? (id ?? context.inputId) : undefined}
              inputMode="numeric"
              maxLength={DATE_SEGMENT_LENGTH[segment]}
              placeholder={DATE_SEGMENT_PLACEHOLDER[segment]}
              required={required}
              title={title}
              type="text"
              value={context.draftParts[segment]}
              onBlur={handleBlur(segment)}
              onChange={handleChange(segment)}
              onFocus={handleFocus(segment)}
              onKeyDown={handleKeyDown(segment)}
              onMouseUp={handleMouseUp}
              onPaste={handlePaste(segment)}
            />
            {index < DATE_SEGMENT_ORDER.length - 1 ? (
              <span className="hts-date-shell__separator" aria-hidden>
                {separator}
              </span>
            ) : null}
          </Fragment>
        ))}
      </fieldset>
    );
  },
);

DateInputField.displayName = 'DateInputField';

export interface DateInputTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
}

const DateInputTrigger = memo(
  ({
    'aria-label': ariaLabel,
    className,
    onClick,
    title = '날짜 선택기 열기',
    ...props
  }: DateInputTriggerProps): ReactElement => {
    const context = useDateInputPopupContext('DateInput.Trigger');

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
            context.commitDraft({ shouldClose: true });
            return;
          }

          context.setViewMode('day');
          context.setOpen(true);
        }}
      >
        {props.children ?? <CalendarDays size={15} aria-hidden />}
      </button>
    );
  },
);

DateInputTrigger.displayName = 'DateInputTrigger';

export interface DateInputContentProps {
  children: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

const DateInputContent = memo(
  ({ children, className, style }: DateInputContentProps): ReactElement => {
    const context = useDateInputPopupContext('DateInput.Content');

    return (
      <ControlPopup
        anchorRef={context.rootRef}
        className={joinClasses('hts-control-popup', 'hts-control-popup--date', className)}
        id={`${context.inputId}-calendar`}
        onDismiss={(reason) => context.dismissPopup(reason)}
        open={context.open}
        portalMode="body"
        popupRef={context.popupRef}
        role="dialog"
        style={style}
        widthMode="content"
        minWidth={296}
        animate={false}
      >
        {children}
      </ControlPopup>
    );
  },
);

DateInputContent.displayName = 'DateInputContent';

export interface DateInputCalendarProps {
  className?: string | undefined;
}

const DateInputCalendar = memo(({ className }: DateInputCalendarProps): ReactElement => {
  const context = useDateInputPopupContext('DateInput.Calendar');
  const year = context.visibleMonth.getFullYear();
  const month = context.visibleMonth.getMonth();
  const todayIso = useMemo(() => getTodayIso(), []);
  const previousMonthDate = useMemo(() => new Date(year, month - 1, 1), [year, month]);
  const nextMonthDate = useMemo(() => new Date(year, month + 1, 1), [year, month]);
  const previousYear = year - 1;
  const nextYear = year + 1;
  const previousYearPageStart = context.yearPageStart - YEAR_PAGE_SIZE;
  const nextYearPageStart = context.yearPageStart + YEAR_PAGE_SIZE;
  const yearCells = useMemo(
    () =>
      Array.from({ length: YEAR_PAGE_SIZE }, (_, index) => {
        const gridYear = context.yearPageStart + index;
        const isDisabled = !canSelectYear(gridYear, context.min, context.max);

        return {
          gridYear,
          isDisabled,
          isSelected: !isDisabled && gridYear === year,
        };
      }),
    [context.yearPageStart, context.min, context.max, year],
  );
  const monthCells = useMemo(
    () =>
      MONTH_OPTIONS.map((monthIndex) => {
        const isDisabled = !canSelectMonth(year, monthIndex, context.min, context.max);

        return {
          isDisabled,
          isSelected: !isDisabled && monthIndex === month,
          monthIndex,
        };
      }),
    [context.min, context.max, month, year],
  );
  const calendarDays = useMemo<CalendarDayCell[]>(
    () =>
      buildCalendarDays(context.visibleMonth).map((dayItem) => {
        const isDisabled =
          (context.min !== undefined && dayItem.iso < context.min) ||
          (context.max !== undefined && dayItem.iso > context.max);

        return {
          ...dayItem,
          isDisabled,
          isSelected: !isDisabled && context.value === dayItem.iso,
          isToday: dayItem.iso === todayIso,
        };
      }),
    [context.max, context.min, context.value, context.visibleMonth, todayIso],
  );
  const canGoPrev = useMemo(() => {
    if (context.viewMode === 'year') {
      return canSelectYearPage(previousYearPageStart, context.min, context.max);
    }
    if (context.viewMode === 'month') {
      return canSelectYear(previousYear, context.min, context.max);
    }
    return canSelectMonth(
      previousMonthDate.getFullYear(),
      previousMonthDate.getMonth(),
      context.min,
      context.max,
    );
  }, [
    context.max,
    context.min,
    context.viewMode,
    previousMonthDate,
    previousYear,
    previousYearPageStart,
  ]);
  const canGoNext = useMemo(() => {
    if (context.viewMode === 'year') {
      return canSelectYearPage(nextYearPageStart, context.min, context.max);
    }
    if (context.viewMode === 'month') {
      return canSelectYear(nextYear, context.min, context.max);
    }
    return canSelectMonth(
      nextMonthDate.getFullYear(),
      nextMonthDate.getMonth(),
      context.min,
      context.max,
    );
  }, [context.max, context.min, context.viewMode, nextMonthDate, nextYear, nextYearPageStart]);

  const handlePrev = (): void => {
    if (!canGoPrev) return;

    if (context.viewMode === 'year') {
      context.shiftYearPage(-YEAR_PAGE_SIZE);
      return;
    }

    if (context.viewMode === 'month') {
      context.setVisibleMonth(new Date(year - 1, month, 1));
      return;
    }

    context.shiftVisibleMonth(-1);
  };

  const handleNext = (): void => {
    if (!canGoNext) return;

    if (context.viewMode === 'year') {
      context.shiftYearPage(YEAR_PAGE_SIZE);
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
          disabled={!canGoPrev}
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
          disabled={!canGoNext}
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
          {yearCells.map((yearCell) => (
            <button
              key={yearCell.gridYear}
              aria-label={`${yearCell.gridYear}년 선택`}
              className={joinClasses(
                'hts-date-popup__month-cell',
                yearCell.isSelected && 'hts-date-popup__month-cell--selected',
                yearCell.isDisabled && 'hts-date-popup__day--disabled',
              )}
              disabled={yearCell.isDisabled}
              type="button"
              onClick={() => {
                context.setVisibleMonth(new Date(yearCell.gridYear, month, 1));
                context.setViewMode('month');
              }}
            >
              {yearCell.gridYear}
            </button>
          ))}
        </div>
      ) : null}

      {context.viewMode === 'month' ? (
        <div className="hts-date-popup__month-grid">
          {monthCells.map((monthCell) => (
            <button
              key={monthCell.monthIndex}
              aria-label={`${monthCell.monthIndex + 1}월 선택`}
              className={joinClasses(
                'hts-date-popup__month-cell',
                monthCell.isSelected && 'hts-date-popup__month-cell--selected',
                monthCell.isDisabled && 'hts-date-popup__day--disabled',
              )}
              disabled={monthCell.isDisabled}
              type="button"
              onClick={() => {
                context.setVisibleMonth(new Date(year, monthCell.monthIndex, 1));
                context.setViewMode('day');
              }}
            >
              {monthCell.monthIndex + 1}월
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
              return (
                <button
                  key={dayItem.iso}
                  aria-label={`${dayItem.iso} 선택`}
                  className={joinClasses(
                    'hts-date-popup__day',
                    !dayItem.inCurrentMonth && 'hts-date-popup__day--adjacent',
                    dayItem.isSelected && 'hts-date-popup__day--selected',
                    dayItem.isToday && 'hts-date-popup__day--today',
                    dayItem.isDisabled && 'hts-date-popup__day--disabled',
                  )}
                  disabled={dayItem.isDisabled}
                  type="button"
                  onClick={() => {
                    context.commitValue(dayItem.iso, {
                      restoreFocus: true,
                      shouldClose: true,
                    });
                  }}
                >
                  {dayItem.dayLabel}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
});

DateInputCalendar.displayName = 'DateInputCalendar';

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

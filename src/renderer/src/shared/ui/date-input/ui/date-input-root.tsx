import type { ReactElement, RefObject } from 'react';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import {
  DATE_SEGMENT_ORDER,
  getYearPageStart,
  hasDraftPartsValue,
  joinClasses,
  normalizeDraftParts,
  parseRecoverableDraft,
  toCalendarMonth,
  toDraftParts,
} from '../lib/date-input-values';
import { DateInputFieldContext, DateInputPopupContext } from '../model/date-input-context';
import type {
  DateInputFieldContextValue,
  DateInputPopupContextValue,
  DateInputRootProps,
  DateSegmentName,
  DateViewMode,
  DismissReason,
} from '../model/types';

export const DateInputRoot = ({
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

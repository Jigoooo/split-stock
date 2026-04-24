import { useEffect, useState } from 'react';
import { clampDate, formatPickerDate, parsePickerDate } from '../lib/date-picker-values';
import type { DatePickerProps, UseDatePickerReturn } from './types';

export function useDatePicker({
  mode = 'day',
  value,
  onChange,
  min,
  max,
  dateFormat,
}: DatePickerProps): UseDatePickerReturn {
  const parsedValue = parsePickerDate(value, mode, dateFormat);
  const minDate = parsePickerDate(min, mode, dateFormat);
  const maxDate = parsePickerDate(max, mode, dateFormat);
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsedValue);
  const [isOpen, setIsOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(
    clampDate(parsedValue ?? new Date(), minDate, maxDate),
  );
  const [displayMode, setDisplayMode] = useState(mode);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) {
        setSelectedDate(parsedValue);
      }
    });

    return () => {
      active = false;
    };
  }, [parsedValue]);

  useEffect(() => {
    if (isOpen) return;

    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setCurrentDate(clampDate(parsedValue ?? new Date(), minDate, maxDate));
      setDisplayMode(mode);
    });

    return () => {
      active = false;
    };
  }, [isOpen, maxDate, minDate, mode, parsedValue]);

  const commitSelection = (date: Date) => {
    const nextDate = clampDate(date, minDate, maxDate);

    setSelectedDate(nextDate);
    setCurrentDate(nextDate);
    setDisplayMode(mode);
    setIsOpen(false);
    onChange?.(formatPickerDate(nextDate, mode, dateFormat));
  };

  return {
    selectedDate,
    isOpen,
    setIsOpen,
    currentDate,
    setCurrentDate,
    displayMode,
    setDisplayMode,
    minDate,
    maxDate,
    commitSelection,
  };
}

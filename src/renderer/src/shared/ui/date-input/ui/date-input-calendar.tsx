import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeyboardEvent, ReactElement } from 'react';
import { memo, useMemo } from 'react';
import {
  buildCalendarDays,
  type CalendarDayCell,
  canSelectMonth,
  canSelectYear,
  canSelectYearPage,
  getTodayIso,
  joinClasses,
  MONTH_OPTIONS,
  WEEKDAY_LABELS,
  YEAR_PAGE_SIZE,
} from '../lib/date-input-values';
import { useDatePickerContext } from '../model/date-input-context';
import type { DateInputCalendarProps } from '../model/types';

export const DateInputCalendar = memo(({ className }: DateInputCalendarProps): ReactElement => {
  const context = useDatePickerContext('DateInput.Calendar');
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

  const focusGridCell = (
    currentTarget: HTMLButtonElement,
    nextIndex: number,
    fallbackDirection: -1 | 1,
  ): void => {
    const grid = currentTarget.closest('[data-calendar-grid]');
    if (!grid) return;

    const cells = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-calendar-cell]'));
    if (cells.length === 0) return;

    let cursor = Math.min(Math.max(nextIndex, 0), cells.length - 1);
    while (cells[cursor]?.disabled) {
      cursor += fallbackDirection;
      if (cursor < 0 || cursor >= cells.length) return;
    }
    cells[cursor]?.focus();
  };

  const handleGridKeyDown =
    (columns: number) =>
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      const currentIndex = Number(event.currentTarget.dataset.calendarIndex);
      if (!Number.isFinite(currentIndex)) return;

      const moveFocus = (nextIndex: number, direction: -1 | 1): void => {
        event.preventDefault();
        focusGridCell(event.currentTarget, nextIndex, direction);
      };

      switch (event.key) {
        case 'ArrowLeft':
          moveFocus(currentIndex - 1, -1);
          return;
        case 'ArrowRight':
          moveFocus(currentIndex + 1, 1);
          return;
        case 'ArrowUp':
          moveFocus(currentIndex - columns, -1);
          return;
        case 'ArrowDown':
          moveFocus(currentIndex + columns, 1);
          return;
        case 'Home':
          moveFocus(currentIndex - (currentIndex % columns), 1);
          return;
        case 'End':
          moveFocus(currentIndex - (currentIndex % columns) + columns - 1, -1);
          return;
        case 'PageUp':
          event.preventDefault();
          handlePrev();
          return;
        case 'PageDown':
          event.preventDefault();
          handleNext();
          return;
        default:
          return;
      }
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
        <div className="hts-date-popup__year-grid" data-calendar-grid>
          {yearCells.map((yearCell, index) => (
            <button
              key={yearCell.gridYear}
              aria-label={`${yearCell.gridYear}년 선택`}
              className={joinClasses(
                'hts-date-popup__month-cell',
                yearCell.isSelected && 'hts-date-popup__month-cell--selected',
                yearCell.isDisabled && 'hts-date-popup__day--disabled',
              )}
              disabled={yearCell.isDisabled}
              data-calendar-cell
              data-calendar-index={index}
              type="button"
              onKeyDown={handleGridKeyDown(4)}
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
        <div className="hts-date-popup__month-grid" data-calendar-grid>
          {monthCells.map((monthCell, index) => (
            <button
              key={monthCell.monthIndex}
              aria-label={`${monthCell.monthIndex + 1}월 선택`}
              className={joinClasses(
                'hts-date-popup__month-cell',
                monthCell.isSelected && 'hts-date-popup__month-cell--selected',
                monthCell.isDisabled && 'hts-date-popup__day--disabled',
              )}
              disabled={monthCell.isDisabled}
              data-calendar-cell
              data-calendar-index={index}
              type="button"
              onKeyDown={handleGridKeyDown(3)}
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
          <div className="hts-date-popup__days" data-calendar-grid>
            {calendarDays.map((dayItem, index) => {
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
                  data-calendar-cell
                  data-calendar-index={index}
                  type="button"
                  onKeyDown={handleGridKeyDown(7)}
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

import { useColors } from '@renderer/shared/theme';
import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { isDateDisabled } from '../lib/date-picker-values';
import { generateDaysArray } from '../lib/generate-days-array';
import { useDatePickerContext } from '../model/date-picker-context';
import { DatePickerNavigationButton } from './date-picker-navigation-button';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function DatePickerDayView() {
  const colors = useColors();
  const {
    currentDate,
    selectedDate,
    minDate,
    maxDate,
    setCurrentDate,
    setDisplayMode,
    commitSelection,
  } = useDatePickerContext();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = generateDaysArray(year, month);

  const disablePrev =
    !!minDate && endOfMonth(subMonths(currentDate, 1)).getTime() < startOfMonth(minDate).getTime();
  const disableNext =
    !!maxDate && startOfMonth(addMonths(currentDate, 1)).getTime() > endOfMonth(maxDate).getTime();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <DatePickerNavigationButton
          direction="prev"
          disabled={disablePrev}
          onClick={() => setCurrentDate(subMonths(currentDate, 1))}
        />
        <button
          type="button"
          aria-label="월 선택 열기"
          onClick={() => setDisplayMode('month')}
          style={{
            border: 0,
            background: 'transparent',
            color: colors.text.primary,
            fontSize: '1.4rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {format(currentDate, 'yyyy년 MMMM', { locale: ko })}
        </button>
        <DatePickerNavigationButton
          direction="next"
          disabled={disableNext}
          onClick={() => setCurrentDate(addMonths(currentDate, 1))}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: '0.3rem',
        }}
      >
        {WEEKDAY_LABELS.map((day) => (
          <div
            key={day}
            style={{
              textAlign: 'center',
              color: colors.text.tertiary,
              fontSize: '1.2rem',
              fontWeight: 700,
              paddingBottom: '0.1rem',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: '0.3rem',
        }}
      >
        {days.map((day) => {
          const disabled = isDateDisabled(day, minDate, maxDate);
          const currentMonth = isSameMonth(day, currentDate);
          const selected = !!selectedDate && isSameDay(day, selectedDate);
          const today = isToday(day);

          return (
            <button
              key={day.toISOString()}
              type="button"
              aria-label={`${format(day, 'yyyy-MM-dd')} 선택`}
              disabled={disabled}
              onClick={() => {
                setCurrentDate(day);
                commitSelection(day);
              }}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                minHeight: '3rem',
                borderRadius: '0.9rem',
                border: selected
                  ? `1px solid ${colors.interactive.primary}`
                  : today
                    ? `1px solid ${colors.border.focus}`
                    : `1px solid ${currentMonth ? colors.border.default : 'transparent'}`,
                backgroundColor: selected
                  ? colors.interactive.primary
                  : currentMonth
                    ? colors.bg.elevated
                    : colors.bg.subtle,
                color: selected
                  ? colors.text.onBrand
                  : disabled
                    ? colors.text.disabled
                    : currentMonth
                      ? colors.text.primary
                      : colors.text.secondary,
                fontSize: '1.25rem',
                fontWeight: selected ? 700 : 500,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.55 : 1,
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                transition:
                  'background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease',
              }}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

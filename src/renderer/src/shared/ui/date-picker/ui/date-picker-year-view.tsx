import { useColors } from '@renderer/shared/theme';
import { addYears, getYear, isSameYear, setYear, subYears } from 'date-fns';
import { useDatePickerContext } from '../model/date-picker-context';
import { DatePickerNavigationButton } from './date-picker-navigation-button';

export function DatePickerYearView() {
  const colors = useColors();
  const {
    mode,
    currentDate,
    selectedDate,
    minDate,
    maxDate,
    setCurrentDate,
    setDisplayMode,
    commitSelection,
  } = useDatePickerContext();

  const currentYear = currentDate.getFullYear();
  const startYear = Math.floor(currentYear / 12) * 12;
  const minYear = minDate ? getYear(minDate) : null;
  const maxYear = maxDate ? getYear(maxDate) : null;
  const years = Array.from({ length: 12 }, (_, index) => startYear + index);

  const disablePrev = minYear !== null && startYear <= minYear;
  const disableNext = maxYear !== null && startYear + 11 >= maxYear;

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
          onClick={() => setCurrentDate(subYears(currentDate, 12))}
        />
        <div
          style={{
            color: colors.text.primary,
            fontSize: '1.4rem',
            fontWeight: 700,
          }}
        >
          {startYear} - {startYear + 11}
        </div>
        <DatePickerNavigationButton
          direction="next"
          disabled={disableNext}
          onClick={() => setCurrentDate(addYears(currentDate, 12))}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '0.5rem',
        }}
      >
        {years.map((year) => {
          const targetDate = setYear(currentDate, year);
          const disabled =
            (minYear !== null && year < minYear) || (maxYear !== null && year > maxYear);
          const selected = !!selectedDate && isSameYear(targetDate, selectedDate);

          return (
            <button
              key={year}
              type="button"
              aria-label={`${year}년 선택`}
              disabled={disabled}
              onClick={() => {
                setCurrentDate(targetDate);
                if (mode === 'year') {
                  commitSelection(targetDate);
                  return;
                }
                setDisplayMode('month');
              }}
              style={{
                minHeight: '3.6rem',
                borderRadius: '1rem',
                border: `1px solid ${selected ? colors.interactive.primary : colors.border.default}`,
                backgroundColor: selected ? colors.interactive.primary : colors.bg.elevated,
                color: selected
                  ? colors.text.onBrand
                  : disabled
                    ? colors.text.disabled
                    : colors.text.primary,
                fontSize: '1.3rem',
                fontWeight: selected ? 700 : 500,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {year}
            </button>
          );
        })}
      </div>
    </div>
  );
}

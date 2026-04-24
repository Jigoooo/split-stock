import { useDatePickerContext } from '../model/date-picker-context';
import { DatePickerDayView } from './date-picker-day-view';
import { DatePickerMonthView } from './date-picker-month-view';
import { DatePickerYearView } from './date-picker-year-view';

export function DatePickerCalendar() {
  const { displayMode } = useDatePickerContext();

  switch (displayMode) {
    case 'year':
      return <DatePickerYearView />;
    case 'month':
      return <DatePickerMonthView />;
    default:
      return <DatePickerDayView />;
  }
}

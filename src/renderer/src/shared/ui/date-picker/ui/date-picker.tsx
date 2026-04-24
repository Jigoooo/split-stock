import { BaseDatePicker } from './base-date-picker';
import { DatePickerCalendar } from './date-picker-calendar';
import { DatePickerContent } from './date-picker-content';
import { DatePickerRoot } from './date-picker-root';
import { DatePickerTrigger } from './date-picker-trigger';

export const DatePicker = Object.assign(BaseDatePicker, {
  Root: DatePickerRoot,
  Trigger: DatePickerTrigger,
  Content: DatePickerContent,
  Calendar: DatePickerCalendar,
});

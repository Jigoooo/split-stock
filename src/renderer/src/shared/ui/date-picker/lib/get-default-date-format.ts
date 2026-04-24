import type { DatePickerMode } from '../model/types';

export function getDefaultDateFormat(mode: DatePickerMode, inputDateFormat?: string) {
  if (inputDateFormat) {
    return inputDateFormat;
  }

  switch (mode) {
    case 'year':
      return 'yyyy';
    case 'month':
      return 'yyyy-MM';
    default:
      return 'yyyy-MM-dd';
  }
}

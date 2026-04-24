import { DateInput } from '../../date-input';
import type { DatePickerProps, DatePickerRootProps } from '../model/types';
import { BaseDatePicker } from './base-date-picker';
import { DatePickerContent } from './date-picker-content';
import { DatePickerTrigger } from './date-picker-trigger';
import { DatePickerValue } from './date-picker-value';

const DatePickerRoot = (props: DatePickerRootProps) => <DateInput.Root {...props} />;

type DatePickerComponent = ((props: DatePickerProps) => ReturnType<typeof BaseDatePicker>) & {
  Calendar: typeof DateInput.Calendar;
  Content: typeof DatePickerContent;
  Root: typeof DatePickerRoot;
  Trigger: typeof DatePickerTrigger;
  Value: typeof DatePickerValue;
};

export const DatePicker = Object.assign(BaseDatePicker, {
  Calendar: DateInput.Calendar,
  Content: DatePickerContent,
  Root: DatePickerRoot,
  Trigger: DatePickerTrigger,
  Value: DatePickerValue,
}) as DatePickerComponent;

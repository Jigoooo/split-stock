import { createContext, useContext } from 'react';

import type { DatePickerContextValue } from './types';

const DatePickerContext = createContext<DatePickerContextValue | null>(null);

export const DatePickerContextProvider = DatePickerContext.Provider;

export function useDatePickerContext() {
  const context = useContext(DatePickerContext);

  if (!context) {
    throw new Error('DatePicker compound components must be used within DatePicker.Root.');
  }

  return context;
}

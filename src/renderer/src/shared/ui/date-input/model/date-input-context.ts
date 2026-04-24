import { createContext, useContext } from 'react';
import type { DateInputFieldContextValue, DateInputPopupContextValue } from './types';

export const DateInputFieldContext = createContext<DateInputFieldContextValue | null>(null);
export const DateInputPopupContext = createContext<DateInputPopupContextValue | null>(null);

export function useDateInputFieldContext(component: string): DateInputFieldContextValue {
  const context = useContext(DateInputFieldContext);
  if (!context) {
    throw new Error(`${component} must be used within DateInput.Root`);
  }
  return context;
}

export function useDatePickerContext(component: string): DateInputPopupContextValue {
  const context = useContext(DateInputPopupContext);
  if (!context) {
    throw new Error(`${component} must be used within DateInput.Root`);
  }
  return context;
}

import { createContext, useContext } from 'react';
import type { SelectContextValue } from './types';

export const SelectContext = createContext<SelectContextValue | null>(null);

export function useSelectContext(component: string): SelectContextValue {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error(`${component} must be used within Select.Root`);
  }
  return context;
}

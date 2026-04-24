import type { ReactElement, ReactNode } from 'react';
import { memo } from 'react';
import { useColors } from '../../../theme';
import { DateInput } from '../../date-input';

export interface DatePickerContentProps {
  children: ReactNode;
}

export const DatePickerContent = memo(({ children }: DatePickerContentProps): ReactElement => {
  const colors = useColors();

  return (
    <DateInput.Content
      style={{
        padding: '1rem',
        borderRadius: '1.4rem',
        border: `1px solid ${colors.border.default}`,
        background: `linear-gradient(180deg, ${colors.bg.elevated}, ${colors.bg.subtle})`,
        boxShadow: `0 28px 64px ${colors.shadow.modal}`,
      }}
    >
      {children}
    </DateInput.Content>
  );
});

DatePickerContent.displayName = 'DatePickerContent';

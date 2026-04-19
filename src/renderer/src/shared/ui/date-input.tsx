import type { InputHTMLAttributes, ReactElement } from 'react';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export interface DateInputProps extends NativeInputProps {
  dense?: boolean;
}

export const DateInput = ({ dense = false, className, ...props }: DateInputProps): ReactElement => {
  return (
    <input
      {...props}
      type="date"
      className={['hts-date-input', dense ? 'hts-date-input--dense' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    />
  );
};

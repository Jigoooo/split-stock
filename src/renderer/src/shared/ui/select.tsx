import type { ReactElement, SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  dense?: boolean;
}

export const Select = ({
  dense = false,
  className,
  children,
  ...props
}: SelectProps): ReactElement => {
  return (
    <select
      {...props}
      className={['hts-select', dense ? 'hts-select--dense' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </select>
  );
};

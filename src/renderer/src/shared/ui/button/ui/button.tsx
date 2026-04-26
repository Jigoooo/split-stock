import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'ghost-danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  active?: boolean;
  dense?: boolean;
  iconLeading?: ReactNode;
  iconOnly?: boolean;
}

export const Button = ({
  variant = 'default',
  active = false,
  dense = false,
  iconLeading,
  iconOnly = false,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps): ReactElement => {
  const classes = [
    'hts-btn',
    dense ? 'hts-btn--dense' : '',
    iconOnly ? 'hts-btn--icon-only' : '',
    variant === 'primary' ? 'hts-btn--primary' : '',
    variant === 'danger' ? 'hts-btn--danger' : '',
    variant === 'ghost' ? 'hts-btn--ghost' : '',
    variant === 'ghost-danger' ? 'hts-btn--ghost hts-btn--ghost-danger' : '',
    active ? 'hts-btn--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {iconLeading ? <span aria-hidden>{iconLeading}</span> : null}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  );
};

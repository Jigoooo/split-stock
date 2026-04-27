import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

type ButtonVariant =
  | 'default'
  | 'primary'
  | 'danger'
  | 'destructive'
  | 'sell'
  | 'ghost'
  | 'ghost-danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  active?: boolean;
  dense?: boolean;
  iconLeading?: ReactNode;
  iconOnly?: boolean;
  /**
   * pending 표시. true 면 좌측에 스피너가 보이고 자동으로 disabled 처리된다.
   * 텍스트(`children`) 는 그대로 유지하되 별도 `loadingText` 가 있으면 그것으로 교체.
   */
  loading?: boolean | undefined;
  loadingText?: ReactNode | undefined;
  /** React 19 ref-as-prop. forwardRef 미사용. */
  ref?: Ref<HTMLButtonElement> | undefined;
}

export const Button = ({
  variant = 'default',
  active = false,
  dense = false,
  iconLeading,
  iconOnly = false,
  loading = false,
  loadingText,
  className,
  children,
  type = 'button',
  disabled,
  'aria-busy': ariaBusy,
  ref,
  ...props
}: ButtonProps): ReactElement => {
  const classes = [
    'hts-btn',
    dense ? 'hts-btn--dense' : '',
    iconOnly ? 'hts-btn--icon-only' : '',
    loading ? 'hts-btn--loading' : '',
    variant === 'primary' ? 'hts-btn--primary' : '',
    variant === 'danger' ? 'hts-btn--danger' : '',
    variant === 'destructive' ? 'hts-btn--destructive' : '',
    variant === 'sell' ? 'hts-btn--down' : '',
    variant === 'ghost' ? 'hts-btn--ghost' : '',
    variant === 'ghost-danger' ? 'hts-btn--ghost hts-btn--ghost-danger' : '',
    active ? 'hts-btn--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const effectiveDisabled = disabled || loading;
  const content = loading && loadingText !== undefined ? loadingText : children;

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={effectiveDisabled}
      aria-busy={ariaBusy ?? loading}
      {...props}
    >
      {loading ? (
        <span className="hts-btn__spinner" aria-hidden />
      ) : iconLeading ? (
        <span aria-hidden>{iconLeading}</span>
      ) : null}
      {iconOnly ? <span className="sr-only">{content}</span> : content}
    </button>
  );
};

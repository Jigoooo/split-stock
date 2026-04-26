import type { ButtonHTMLAttributes, ReactElement } from 'react';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'role'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string | undefined;
  tone?: 'accent' | 'danger' | 'success';
}

export const Switch = ({
  checked,
  className,
  disabled,
  label,
  onChange,
  tone = 'accent',
  type = 'button',
  ...props
}: SwitchProps): ReactElement => {
  const classes = ['hts-switch', className ?? ''].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      className={classes}
      data-state={checked ? 'checked' : 'unchecked'}
      data-tone={tone}
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented || disabled) return;
        onChange(!checked);
      }}
    >
      <span className="hts-switch__track" aria-hidden>
        <span className="hts-switch__thumb" />
      </span>
      {label ? <span className="hts-switch__label">{label}</span> : null}
    </button>
  );
};

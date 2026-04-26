import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export interface CheckboxProps extends NativeProps {
  label?: ReactNode;
  description?: ReactNode;
  dense?: boolean;
}

export const Checkbox = ({
  label,
  description,
  dense = false,
  className,
  ...props
}: CheckboxProps): ReactElement => {
  const standalone = !label && !description;

  return (
    <label
      className={[
        'hts-choice',
        'hts-choice--checkbox',
        standalone ? 'hts-choice--standalone' : '',
        props.disabled ? 'hts-choice--disabled' : '',
        dense ? 'hts-choice--dense' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input {...props} className="hts-choice__native" type="checkbox" />
      <span className="hts-choice__control" aria-hidden />
      {label || description ? (
        <span className="hts-choice__content">
          {label ? <span className="hts-choice__label">{label}</span> : null}
          {description ? <span className="hts-choice__description">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
};

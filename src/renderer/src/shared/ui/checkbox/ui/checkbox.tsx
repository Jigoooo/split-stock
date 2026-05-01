import {
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
} from 'react';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export interface CheckboxProps extends NativeProps {
  label?: ReactNode;
  description?: ReactNode;
  dense?: boolean;
  indeterminate?: boolean;
}

export const Checkbox = ({
  label,
  description,
  dense = false,
  indeterminate = false,
  className,
  ...props
}: CheckboxProps): ReactElement => {
  const standalone = !label && !description;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

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
      <input
        {...props}
        ref={inputRef}
        className="hts-choice__native"
        type="checkbox"
        aria-checked={indeterminate ? 'mixed' : props.checked}
      />
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

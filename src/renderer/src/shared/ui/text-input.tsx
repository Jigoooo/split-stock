import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  dense?: boolean;
  iconLeading?: ReactNode;
}

export const TextInput = ({
  dense = false,
  iconLeading,
  className,
  ...props
}: TextInputProps): ReactElement => {
  const inputClassName = ['hts-input', dense ? 'hts-input--dense' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  if (!iconLeading) {
    return <input {...props} className={inputClassName} />;
  }

  return (
    <span className={['hts-input-shell', dense ? 'hts-input-shell--dense' : ''].join(' ').trim()}>
      <span className="hts-input-shell__icon" aria-hidden>
        {iconLeading}
      </span>
      <input {...props} className={inputClassName} />
    </span>
  );
};

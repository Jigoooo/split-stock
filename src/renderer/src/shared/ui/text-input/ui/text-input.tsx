import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  dense?: boolean;
  iconLeading?: ReactNode;
  /** 우측 슬롯 — show/hide 토글, 입력 단위 라벨, clear 버튼 등. */
  suffix?: ReactNode;
}

export const TextInput = ({
  dense = false,
  iconLeading,
  suffix,
  className,
  ...props
}: TextInputProps): ReactElement => {
  const inputClassName = ['hts-input', dense ? 'hts-input--dense' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  // shell 이 필요한 경우는 leading 아이콘 또는 suffix slot 둘 중 하나라도 있을 때.
  if (!iconLeading && !suffix) {
    return <input {...props} className={inputClassName} />;
  }

  return (
    <span className={['hts-input-shell', dense ? 'hts-input-shell--dense' : ''].join(' ').trim()}>
      {iconLeading ? (
        <span className="hts-input-shell__icon" aria-hidden>
          {iconLeading}
        </span>
      ) : null}
      <input {...props} className={inputClassName} />
      {suffix ? <span className="hts-input-shell__suffix">{suffix}</span> : null}
    </span>
  );
};

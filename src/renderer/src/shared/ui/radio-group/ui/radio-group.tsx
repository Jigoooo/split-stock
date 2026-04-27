import type { ReactElement, ReactNode } from 'react';

export interface RadioGroupItem<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** 위험 옵션(예: 실전 PROD) — 활성 시 빨강(`--up`) 색상으로 강조. */
  tone?: 'default' | 'danger';
}

export interface RadioGroupProps<T extends string> {
  value: T;
  items: RadioGroupItem<T>[];
  onChange: (next: T) => void;
  name: string;
  ariaLabel: string;
  dense?: boolean;
}

export const RadioGroup = <T extends string>({
  value,
  items,
  onChange,
  name,
  ariaLabel,
  dense = false,
}: RadioGroupProps<T>): ReactElement => {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={['hts-choice-group', dense ? 'hts-choice-group--dense' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {items.map((item) => (
        <label
          key={item.value}
          className={[
            'hts-choice',
            item.value === value ? 'hts-choice--active' : '',
            item.disabled ? 'hts-choice--disabled' : '',
            dense ? 'hts-choice--dense' : '',
            item.tone === 'danger' ? 'hts-choice--danger' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <input
            className="hts-choice__native"
            type="radio"
            name={name}
            value={item.value}
            checked={item.value === value}
            disabled={item.disabled}
            onChange={() => onChange(item.value)}
          />
          <span className="hts-choice__control" aria-hidden />
          <span className="hts-choice__content">
            <span className="hts-choice__label">{item.label}</span>
            {item.description ? (
              <span className="hts-choice__description">{item.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
};

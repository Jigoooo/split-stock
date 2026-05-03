import type { ReactElement } from 'react';

interface SegmentedToggleItem<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedToggleProps<T extends string> {
  value: T;
  items: SegmentedToggleItem<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  dense?: boolean;
  /** 컨테이너 너비를 채우고 각 item을 동등 분할 (지정가/시장가 토글용) */
  fullWidth?: boolean;
}

export const SegmentedToggle = <T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  dense = false,
  fullWidth = false,
}: SegmentedToggleProps<T>): ReactElement => {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        'hts-segmented',
        dense ? 'hts-segmented--dense' : '',
        fullWidth ? 'hts-segmented--full-width' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segmented control keeps button styling while exposing radiogroup semantics.
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={[
              'hts-segmented__item',
              active ? 'hts-segmented__item--active' : '',
              dense ? 'hts-segmented__item--dense' : '',
              fullWidth ? 'hts-segmented__item--full-width' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const index = items.findIndex((candidate) => candidate.value === value);
              const offset = event.key === 'ArrowRight' ? 1 : -1;
              const next = items[(index + offset + items.length) % items.length];
              if (next) onChange(next.value);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

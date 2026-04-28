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
}

export const SegmentedToggle = <T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  dense = false,
}: SegmentedToggleProps<T>): ReactElement => {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={['hts-segmented', dense ? 'hts-segmented--dense' : ''].filter(Boolean).join(' ')}
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

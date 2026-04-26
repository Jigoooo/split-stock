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
      role="tablist"
      aria-label={ariaLabel}
      className={['hts-segmented', dense ? 'hts-segmented--dense' : ''].filter(Boolean).join(' ')}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[
              'hts-segmented__item',
              active ? 'hts-segmented__item--active' : '',
              dense ? 'hts-segmented__item--dense' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

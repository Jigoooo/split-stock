import type { ReactElement } from 'react';

interface QuickPreset<T extends string | number> {
  label: string;
  value: T;
}

interface QuickPresetRowProps<T extends string | number> {
  label: string;
  options: ReadonlyArray<QuickPreset<T>>;
  onSelect: (value: T) => void;
}

export const QuickPresetRow = <T extends string | number>({
  label,
  onSelect,
  options,
}: QuickPresetRowProps<T>): ReactElement => (
  <div className="profit-calculator__preset-row">
    <span className="profit-calculator__preset-label">{label}</span>
    <div className="profit-calculator__preset-options">
      {options.map((option) => (
        <button
          key={`${label}-${option.value}`}
          type="button"
          className="profit-calculator__preset-button"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

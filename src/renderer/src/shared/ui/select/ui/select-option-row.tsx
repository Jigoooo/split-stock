import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { joinClasses } from '../lib/select-values';
import type { SelectOptionRowProps } from '../model/types';

export const SelectOptionRow = memo(
  ({
    dense,
    disabled,
    id,
    isActive,
    isSelected,
    label,
    onActivate,
    onSelect,
    value,
  }: SelectOptionRowProps): ReactElement => (
    <button
      id={id}
      aria-disabled={disabled}
      aria-selected={isSelected}
      className={joinClasses(
        'hts-control-option',
        dense && 'hts-control-option--dense',
        isActive && 'hts-control-option--active',
        isSelected && 'hts-control-option--selected',
        disabled && 'hts-control-option--disabled',
      )}
      data-select-option
      role="option"
      tabIndex={-1}
      type="button"
      onClick={() => {
        if (disabled) return;
        onSelect(value, true);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={() => {
        if (disabled) return;
        onActivate(value);
      }}
    >
      <span className="hts-control-option__label">{label}</span>
      <span
        className={joinClasses(
          'hts-control-option__check',
          !isSelected && 'hts-control-option__check--hidden',
        )}
        aria-hidden
      >
        <Check size={13} />
      </span>
    </button>
  ),
);

SelectOptionRow.displayName = 'SelectOptionRow';

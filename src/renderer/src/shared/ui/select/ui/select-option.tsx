import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useId, useRef } from 'react';
import { joinClasses } from '../lib/select-values';
import { useSelectContext } from '../model/select-context';
import type { SelectOptionProps } from '../model/types';

export const SelectOption = ({
  children,
  disabled = false,
  value,
}: SelectOptionProps): ReactElement => {
  const context = useSelectContext('Select.Option');
  const registerOption = context.registerOption;
  const unregisterOption = context.unregisterOption;
  const registerOptionRef = useRef(registerOption);
  const unregisterOptionRef = useRef(unregisterOption);
  const runtimeOptionId = useId();
  const snapshotOption =
    context.optionSnapshot === undefined
      ? undefined
      : (context.optionLookup.byValue.get(value) ?? undefined);
  const optionId = snapshotOption?.id ?? runtimeOptionId;
  const isActive = context.activeValue === value;
  const isSelected = context.value === value;

  registerOptionRef.current = registerOption;
  unregisterOptionRef.current = unregisterOption;

  useEffect(() => {
    if (snapshotOption) return;

    registerOptionRef.current({
      disabled,
      id: optionId,
      label: children,
      value,
    });

    return () => {
      unregisterOptionRef.current(value);
    };
  }, [children, disabled, optionId, snapshotOption, value]);

  return (
    <button
      id={optionId}
      aria-disabled={disabled}
      aria-selected={isSelected}
      className={joinClasses(
        'hts-control-option',
        context.dense && 'hts-control-option--dense',
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
        context.selectValue(value, true);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={() => {
        if (disabled) return;
        context.setActiveValue(value);
      }}
    >
      <span
        className={joinClasses(
          'hts-control-option__check',
          !isSelected && 'hts-control-option__check--hidden',
        )}
        aria-hidden
      >
        <Check size={13} />
      </span>
      <span className="hts-control-option__label">{children}</span>
    </button>
  );
};

import type { ButtonHTMLAttributes, FocusEventHandler, ReactElement } from 'react';
import {
  createSyntheticSelectChangeEvent,
  extractSelectOptions,
  normalizeSelectValue,
} from '../lib/select-values';
import type { SelectProps } from '../model/types';
import { SelectContentWithPopupRef } from './select-content';
import { SelectOption } from './select-option';
import { SelectRoot } from './select-root';
import { SelectTrigger } from './select-trigger';
import { SelectValue } from './select-value';

const SelectAdapter = (props: SelectProps): ReactElement => {
  const {
    autoFocus,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    children,
    className,
    defaultValue,
    dense = false,
    disabled,
    id,
    name,
    onBlur,
    onChange,
    onClick,
    onFocus,
    onKeyDown,
    placeholder,
    style,
    tabIndex,
    title,
    value,
  } = props;
  const dataTestId = props['data-testid'];
  const options = extractSelectOptions(children);
  const optionSnapshot = options.map((option, index) => ({
    disabled: option.disabled,
    id: `select-option-${id ?? 'shared'}-${index}`,
    label: option.label,
    value: option.value,
  }));

  return (
    <SelectRoot
      defaultValue={normalizeSelectValue(defaultValue)}
      dense={dense}
      disabled={disabled}
      name={name}
      optionSnapshot={optionSnapshot}
      onValueChange={(nextValue) => {
        onChange?.(createSyntheticSelectChangeEvent(nextValue, name));
      }}
      value={value === undefined ? undefined : normalizeSelectValue(value)}
    >
      <SelectTrigger
        autoFocus={autoFocus}
        data-testid={dataTestId}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={className}
        id={id}
        onClick={onClick as ButtonHTMLAttributes<HTMLButtonElement>['onClick']}
        onBlur={onBlur as FocusEventHandler<HTMLButtonElement> | undefined}
        onFocus={onFocus as FocusEventHandler<HTMLButtonElement> | undefined}
        onKeyDown={onKeyDown as ButtonHTMLAttributes<HTMLButtonElement>['onKeyDown']}
        style={style}
        tabIndex={tabIndex}
        title={title}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContentWithPopupRef />
    </SelectRoot>
  );
};

type SelectComponent = ((props: SelectProps) => ReactElement) & {
  Content: typeof SelectContentWithPopupRef;
  Option: typeof SelectOption;
  Root: typeof SelectRoot;
  Trigger: typeof SelectTrigger;
  Value: typeof SelectValue;
};

export const Select = Object.assign(SelectAdapter, {
  Content: SelectContentWithPopupRef,
  Option: SelectOption,
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
}) as SelectComponent;

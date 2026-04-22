import { Check, ChevronDown } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  FocusEvent,
  FocusEventHandler,
  ReactElement,
  ReactNode,
  RefObject,
  SelectHTMLAttributes,
} from 'react';
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { ControlPopup } from './control-popup';

interface SelectOptionMeta {
  disabled: boolean;
  id: string;
  label: ReactNode;
  value: string;
}

interface SelectContextValue {
  activeValue: string;
  dense: boolean;
  disabled: boolean;
  listboxId: string;
  optionSnapshot?: SelectOptionMeta[] | undefined;
  open: boolean;
  options: SelectOptionMeta[];
  registerOption: (meta: SelectOptionMeta) => void;
  selectValue: (value: string, shouldRestoreFocus: boolean) => void;
  setActiveValue: (value: string) => void;
  setOpen: (open: boolean) => void;
  setOpenAndRestore: (open: boolean, shouldRestoreFocus: boolean) => void;
  syncActiveToBoundary: (boundary: 'first' | 'last') => void;
  syncActiveToCurrent: () => void;
  stepActiveValue: (direction: 1 | -1) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  unregisterOption: (value: string) => void;
  value: string;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext(component: string): SelectContextValue {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error(`${component} must be used within Select.Root`);
  }
  return context;
}

function normalizeSelectValue(
  value: SelectHTMLAttributes<HTMLSelectElement>['value'] | undefined,
): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }

  return value === undefined || value === null ? '' : String(value);
}

function createSyntheticSelectChangeEvent(
  nextValue: string,
  name: string | undefined,
): ChangeEvent<HTMLSelectElement> {
  const target = {
    name,
    value: nextValue,
  };

  return {
    bubbles: true,
    cancelable: false,
    currentTarget: target,
    defaultPrevented: false,
    eventPhase: 3,
    isTrusted: false,
    nativeEvent: new Event('change'),
    persist: () => undefined,
    preventDefault: () => undefined,
    isDefaultPrevented: () => false,
    stopPropagation: () => undefined,
    isPropagationStopped: () => false,
    target,
    timeStamp: Date.now(),
    type: 'change',
  } as unknown as ChangeEvent<HTMLSelectElement>;
}

function extractSelectOptions(children: ReactNode): Array<{
  disabled: boolean;
  label: ReactNode;
  value: string;
}> {
  const options: Array<{ disabled: boolean; label: ReactNode; value: string }> = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === Fragment) {
      const fragment = child as ReactElement<{ children?: ReactNode }>;
      options.push(...extractSelectOptions(fragment.props.children));
      return;
    }

    if (typeof child.type !== 'string' || child.type !== 'option') return;

    const option = child as ReactElement<{
      children?: ReactNode;
      disabled?: boolean;
      value?: number | string;
    }>;
    const value =
      option.props.value === undefined
        ? String(option.props.children ?? '')
        : String(option.props.value);
    options.push({
      disabled: Boolean(option.props.disabled),
      label: option.props.children,
      value,
    });
  });

  return options;
}

function findSelectableOption(
  options: SelectOptionMeta[],
  currentValue: string,
  direction: 1 | -1,
): SelectOptionMeta | null {
  const enabledOptions = options.filter((option) => !option.disabled);
  if (enabledOptions.length === 0) return null;

  const currentIndex = enabledOptions.findIndex((option) => option.value === currentValue);
  if (currentIndex === -1) {
    return direction === 1 ? (enabledOptions[0] ?? null) : (enabledOptions.at(-1) ?? null);
  }

  const nextIndex = Math.min(enabledOptions.length - 1, Math.max(0, currentIndex + direction));
  return enabledOptions[nextIndex] ?? null;
}

function findBoundaryOption(
  options: SelectOptionMeta[],
  boundary: 'first' | 'last',
): SelectOptionMeta | null {
  const enabledOptions = options.filter((option) => !option.disabled);
  if (enabledOptions.length === 0) return null;
  return boundary === 'first' ? (enabledOptions[0] ?? null) : (enabledOptions.at(-1) ?? null);
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface SelectRootProps {
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  defaultValue?: string | undefined;
  dense?: boolean | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  optionSnapshot?: SelectOptionMeta[] | undefined;
  onValueChange?: ((nextValue: string) => void) | undefined;
  open?: boolean | undefined;
  value?: string | undefined;
}

const SelectRoot = ({
  children,
  defaultOpen = false,
  defaultValue = '',
  dense = false,
  disabled = false,
  name,
  onOpenChange,
  optionSnapshot,
  onValueChange,
  open,
  value,
}: SelectRootProps): ReactElement => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [activeValue, setActiveValue] = useState(defaultValue);
  const [options, setOptions] = useState<SelectOptionMeta[]>(optionSnapshot ?? []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const currentValue = value ?? internalValue;
  const isOpen = open ?? internalOpen;
  // 닫힌 상태에서는 live option registry 대신 snapshot을 사용해
  // parent rerender마다 option state를 다시 쓰는 루프를 피한다.
  const resolvedOptions = isOpen ? options : (optionSnapshot ?? options);

  const applyOpenChange = (nextOpen: boolean): void => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const setOpenAndRestore = (nextOpen: boolean, shouldRestoreFocus: boolean): void => {
    applyOpenChange(nextOpen);
    if (nextOpen || !shouldRestoreFocus) return;

    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  };

  const registerOption = useEffectEvent((meta: SelectOptionMeta) => {
    setOptions((prev) => {
      const existingIndex = prev.findIndex((option) => option.value === meta.value);
      if (existingIndex === -1) {
        return [...prev, meta];
      }

      const current = prev[existingIndex];
      if (
        current?.disabled === meta.disabled &&
        current.id === meta.id &&
        current.label === meta.label &&
        current.value === meta.value
      ) {
        return prev;
      }

      const next = [...prev];
      next[existingIndex] = meta;
      return next;
    });
  });

  const unregisterOption = useEffectEvent((nextValue: string) => {
    setOptions((prev) => prev.filter((option) => option.value !== nextValue));
  });

  const syncActiveToCurrent = useEffectEvent(() => {
    const currentOption = resolvedOptions.find(
      (option) => option.value === currentValue && !option.disabled,
    );
    if (currentOption) {
      setActiveValue(currentOption.value);
      return;
    }

    const firstEnabled = findBoundaryOption(resolvedOptions, 'first');
    setActiveValue(firstEnabled?.value ?? '');
  });

  const stepActiveValue = useEffectEvent((direction: 1 | -1) => {
    const next = findSelectableOption(resolvedOptions, activeValue, direction);
    if (next) {
      setActiveValue(next.value);
    }
  });

  const syncActiveToBoundary = useEffectEvent((boundary: 'first' | 'last') => {
    const next = findBoundaryOption(resolvedOptions, boundary);
    if (next) {
      setActiveValue(next.value);
    }
  });

  const selectValue = useEffectEvent((nextValue: string, shouldRestoreFocus: boolean) => {
    if (nextValue !== currentValue) {
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    }

    setActiveValue(nextValue);
    setOpenAndRestore(false, shouldRestoreFocus);
  });

  const previousOpen = useRef(isOpen);

  useEffect(() => {
    const wasOpen = previousOpen.current;
    previousOpen.current = isOpen;
    if (!isOpen || wasOpen) return;
    syncActiveToCurrent();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeValue === '') return;

    const activeOption = resolvedOptions.find((option) => option.value === activeValue);
    if (!activeOption) return;

    window.requestAnimationFrame(() => {
      const optionElement = document.getElementById(activeOption.id);
      optionElement?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [activeValue, isOpen, resolvedOptions]);

  const contextValue: SelectContextValue = {
    activeValue,
    dense,
    disabled,
    listboxId,
    optionSnapshot,
    open: isOpen,
    options: resolvedOptions,
    registerOption,
    selectValue,
    setActiveValue,
    setOpen: applyOpenChange,
    setOpenAndRestore,
    syncActiveToBoundary,
    syncActiveToCurrent,
    stepActiveValue,
    triggerRef,
    unregisterOption,
    value: currentValue,
  };

  return (
    <SelectContext.Provider value={contextValue}>
      <span className="hts-control-root">
        {children}
        {name ? (
          <input
            aria-hidden
            className="hts-control-hidden"
            name={name}
            type="hidden"
            value={currentValue}
          />
        ) : null}
      </span>
    </SelectContext.Provider>
  );
};

export interface SelectTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'value'> {
  children?: ReactNode;
}

const SelectTrigger = ({
  autoFocus,
  children,
  className,
  disabled,
  id,
  onBlur,
  onClick,
  onFocus,
  onKeyDown,
  style,
  title,
  ...props
}: SelectTriggerProps): ReactElement => {
  const context = useSelectContext('Select.Trigger');
  const activeOptionId = context.options.find((option) => option.value === context.activeValue)?.id;
  const isDisabled = context.disabled || disabled;

  useEffect(() => {
    if (!autoFocus) return;
    context.triggerRef.current?.focus();
  }, [autoFocus, context.triggerRef]);

  const handleFocus = (event: FocusEvent<HTMLButtonElement>): void => {
    onFocus?.(event);
  };

  const handleBlur: FocusEventHandler<HTMLButtonElement> = (event) => {
    onBlur?.(event);
  };

  return (
    <button
      {...props}
      ref={context.triggerRef}
      className={joinClasses('hts-select', context.dense && 'hts-select--dense', className)}
      data-state={context.open ? 'open' : 'closed'}
      disabled={isDisabled}
      id={id}
      role="combobox"
      style={style}
      title={title}
      type="button"
      aria-activedescendant={context.open ? activeOptionId : undefined}
      aria-controls={context.listboxId}
      aria-expanded={context.open}
      aria-haspopup="listbox"
      onBlur={handleBlur}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || isDisabled) return;

        if (context.open) {
          context.setOpen(false);
          return;
        }

        context.syncActiveToCurrent();
        context.setOpen(true);
      }}
      onFocus={handleFocus}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || isDisabled) return;

        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            if (!context.open) {
              context.syncActiveToCurrent();
              context.setOpen(true);
            } else {
              context.stepActiveValue(1);
            }
            break;
          case 'ArrowUp':
            event.preventDefault();
            if (!context.open) {
              context.syncActiveToCurrent();
              context.setOpen(true);
            } else {
              context.stepActiveValue(-1);
            }
            break;
          case 'Home':
            if (!context.open) return;
            event.preventDefault();
            context.syncActiveToBoundary('first');
            break;
          case 'End':
            if (!context.open) return;
            event.preventDefault();
            context.syncActiveToBoundary('last');
            break;
          case 'Enter':
          case ' ':
            event.preventDefault();
            if (!context.open) {
              context.syncActiveToCurrent();
              context.setOpen(true);
              return;
            }
            if (context.activeValue !== '') {
              context.selectValue(context.activeValue, true);
            }
            break;
          case 'Escape':
            if (!context.open) return;
            event.preventDefault();
            context.setOpenAndRestore(false, true);
            break;
          case 'Tab':
            if (!context.open) return;
            context.setOpen(false);
            break;
          default:
            break;
        }
      }}
    >
      <span className="hts-select__label-wrap">{children ?? <SelectValue />}</span>
      <span className="hts-select__icon" aria-hidden>
        <ChevronDown size={14} />
      </span>
    </button>
  );
};

export interface SelectValueProps {
  placeholder?: ReactNode;
}

const SelectValue = ({ placeholder = '선택하세요' }: SelectValueProps): ReactElement => {
  const context = useSelectContext('Select.Value');
  const selectedOption = context.options.find((option) => option.value === context.value);

  if (!selectedOption) {
    return <span className="hts-select__label hts-select__label--placeholder">{placeholder}</span>;
  }

  return <span className="hts-select__label">{selectedOption.label}</span>;
};

export interface SelectContentProps {
  children: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export interface SelectOptionProps {
  children: ReactNode;
  disabled?: boolean;
  value: string;
}

const SelectOption = ({ children, disabled = false, value }: SelectOptionProps): ReactElement => {
  const context = useSelectContext('Select.Option');
  const registerOption = context.registerOption;
  const shouldPersistOnUnmount = context.optionSnapshot !== undefined;
  const unregisterOption = context.unregisterOption;
  const registerOptionRef = useRef(registerOption);
  const unregisterOptionRef = useRef(unregisterOption);
  const optionId = useId();
  const isActive = context.activeValue === value;
  const isSelected = context.value === value;

  registerOptionRef.current = registerOption;
  unregisterOptionRef.current = unregisterOption;

  useEffect(() => {
    registerOptionRef.current({
      disabled,
      id: optionId,
      label: children,
      value,
    });

    return () => {
      if (!shouldPersistOnUnmount) {
        unregisterOptionRef.current(value);
      }
    };
  }, [children, disabled, optionId, shouldPersistOnUnmount, value]);

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

function SelectContentWithPopupRef({
  children,
  className,
  style,
}: SelectContentProps): ReactElement {
  const context = useSelectContext('Select.Content');
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <ControlPopup
      anchorRef={context.triggerRef}
      className={joinClasses('hts-control-popup', 'hts-control-popup--select', className)}
      id={context.listboxId}
      onDismiss={(reason) => {
        if (reason === 'escape') {
          context.setOpenAndRestore(false, true);
          return;
        }
        context.setOpen(false);
      }}
      open={context.open}
      popupRef={popupRef}
      role="listbox"
      style={style}
      widthMode="anchor"
    >
      {children}
    </ControlPopup>
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  'data-testid'?: string | undefined;
  children?: ReactNode | undefined;
  dense?: boolean | undefined;
  placeholder?: ReactNode | undefined;
}

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
      <SelectContentWithPopupRef>
        {options.map((option) => (
          <SelectOption
            key={`${option.value}-${String(option.label)}`}
            disabled={option.disabled}
            value={option.value}
          >
            {option.label}
          </SelectOption>
        ))}
      </SelectContentWithPopupRef>
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

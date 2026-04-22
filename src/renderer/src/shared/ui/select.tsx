import { useVirtualizer } from '@tanstack/react-virtual';
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
  memo,
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

interface SelectOptionLookup {
  byValue: Map<string, SelectOptionMeta>;
  enabledIndexByValue: Map<string, number>;
  enabledValues: string[];
  indexByValue: Map<string, number>;
}

interface SelectContextValue {
  activeValue: string;
  dense: boolean;
  disabled: boolean;
  listboxId: string;
  optionLookup: SelectOptionLookup;
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
const SELECT_OPTION_GAP_PX = 2;
const SELECT_OPTION_HEIGHT_PX = 28;
const SELECT_OPTION_DENSE_HEIGHT_PX = 26;
const SELECT_VIRTUALIZE_THRESHOLD = 80;

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
  lookup: SelectOptionLookup,
  currentValue: string,
  direction: 1 | -1,
): SelectOptionMeta | null {
  if (lookup.enabledValues.length === 0) return null;

  const currentIndex = lookup.enabledIndexByValue.get(currentValue);
  if (currentIndex === undefined) {
    const fallbackValue = direction === 1 ? lookup.enabledValues[0] : lookup.enabledValues.at(-1);
    return fallbackValue ? (lookup.byValue.get(fallbackValue) ?? null) : null;
  }

  const nextIndex = Math.min(
    lookup.enabledValues.length - 1,
    Math.max(0, currentIndex + direction),
  );
  const nextValue = lookup.enabledValues[nextIndex];
  return nextValue ? (lookup.byValue.get(nextValue) ?? null) : null;
}

function findBoundaryOption(
  lookup: SelectOptionLookup,
  boundary: 'first' | 'last',
): SelectOptionMeta | null {
  const value = boundary === 'first' ? lookup.enabledValues[0] : lookup.enabledValues.at(-1);
  return value ? (lookup.byValue.get(value) ?? null) : null;
}

function isSameOptionMeta(left: SelectOptionMeta, right: SelectOptionMeta): boolean {
  return (
    left.disabled === right.disabled &&
    left.id === right.id &&
    left.label === right.label &&
    left.value === right.value
  );
}

function buildOptionLookup(options: SelectOptionMeta[]): SelectOptionLookup {
  const byValue = new Map<string, SelectOptionMeta>();
  const enabledIndexByValue = new Map<string, number>();
  const enabledValues: string[] = [];
  const indexByValue = new Map<string, number>();

  options.forEach((option, index) => {
    byValue.set(option.value, option);
    indexByValue.set(option.value, index);
    if (option.disabled) return;
    enabledIndexByValue.set(option.value, enabledValues.length);
    enabledValues.push(option.value);
  });

  return {
    byValue,
    enabledIndexByValue,
    enabledValues,
    indexByValue,
  };
}

function getSelectOptionEstimateSize(dense: boolean): number {
  return (dense ? SELECT_OPTION_DENSE_HEIGHT_PX : SELECT_OPTION_HEIGHT_PX) + SELECT_OPTION_GAP_PX;
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
  const [options, setOptions] = useState<SelectOptionMeta[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const currentValue = value ?? internalValue;
  const isOpen = open ?? internalOpen;
  // adapter path에서는 snapshot을 source of truth로 사용해
  // 첫 오픈 시 option registration 비용을 피한다.
  const resolvedOptions = optionSnapshot ?? options;
  const optionLookup = buildOptionLookup(resolvedOptions);
  const usesVirtualizedSnapshot =
    optionSnapshot !== undefined && resolvedOptions.length >= SELECT_VIRTUALIZE_THRESHOLD;

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
      if (current && isSameOptionMeta(current, meta)) {
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
    const currentOption = optionLookup.byValue.get(currentValue);
    if (currentOption) {
      setActiveValue(
        currentOption.disabled
          ? (findBoundaryOption(optionLookup, 'first')?.value ?? '')
          : currentOption.value,
      );
      return;
    }

    const firstEnabled = findBoundaryOption(optionLookup, 'first');
    setActiveValue(firstEnabled?.value ?? '');
  });

  const stepActiveValue = useEffectEvent((direction: 1 | -1) => {
    const next = findSelectableOption(optionLookup, activeValue, direction);
    if (next) {
      setActiveValue(next.value);
    }
  });

  const syncActiveToBoundary = useEffectEvent((boundary: 'first' | 'last') => {
    const next = findBoundaryOption(optionLookup, boundary);
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
    if (!isOpen || activeValue === '' || usesVirtualizedSnapshot) return;

    const activeOption = optionLookup.byValue.get(activeValue);
    if (!activeOption) return;

    window.requestAnimationFrame(() => {
      const optionElement = document.getElementById(activeOption.id);
      optionElement?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [activeValue, isOpen, optionLookup, usesVirtualizedSnapshot]);

  const contextValue: SelectContextValue = {
    activeValue,
    dense,
    disabled,
    listboxId,
    optionLookup,
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
  const activeOptionId = context.optionLookup.byValue.get(context.activeValue)?.id;
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
  const selectedOption = context.optionLookup.byValue.get(context.value);

  if (!selectedOption) {
    return <span className="hts-select__label hts-select__label--placeholder">{placeholder}</span>;
  }

  return <span className="hts-select__label">{selectedOption.label}</span>;
};

export interface SelectContentProps {
  children?: ReactNode | undefined;
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

interface SelectOptionRowProps {
  dense: boolean;
  disabled: boolean;
  id: string;
  isActive: boolean;
  isSelected: boolean;
  label: ReactNode;
  onActivate: (value: string) => void;
  onSelect: (value: string, shouldRestoreFocus: boolean) => void;
  value: string;
}

const SelectOptionRow = memo(
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
      <span
        className={joinClasses(
          'hts-control-option__check',
          !isSelected && 'hts-control-option__check--hidden',
        )}
        aria-hidden
      >
        <Check size={13} />
      </span>
      <span className="hts-control-option__label">{label}</span>
    </button>
  ),
);

SelectOptionRow.displayName = 'SelectOptionRow';

function SelectContentWithPopupRef({
  children,
  className,
  style,
}: SelectContentProps): ReactElement {
  const context = useSelectContext('Select.Content');
  const popupRef = useRef<HTMLDivElement>(null);
  const snapshotOptions = context.optionSnapshot;
  const shouldVirtualize =
    snapshotOptions !== undefined && snapshotOptions.length >= SELECT_VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? snapshotOptions.length : 0,
    estimateSize: () => getSelectOptionEstimateSize(context.dense),
    getScrollElement: () => popupRef.current,
    overscan: 8,
  });
  const activeIndex =
    snapshotOptions === undefined
      ? -1
      : (context.optionLookup.indexByValue.get(context.activeValue) ?? -1);
  const popupStyle: CSSProperties = {
    maxWidth: 'min(32rem, calc(100vw - 1.6rem))',
  };

  useEffect(() => {
    if (!context.open || !shouldVirtualize || activeIndex < 0) return;
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, context.open, shouldVirtualize, virtualizer]);

  const renderedOptions =
    snapshotOptions === undefined ? (
      children
    ) : shouldVirtualize ? (
      <div
        data-select-virtualized
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const option = snapshotOptions[virtualItem.index];
          if (!option) return null;

          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                boxSizing: 'border-box',
                left: 0,
                paddingBottom: `${SELECT_OPTION_GAP_PX / 10}rem`,
                position: 'absolute',
                right: 0,
                top: 0,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SelectOptionRow
                dense={context.dense}
                disabled={option.disabled}
                id={option.id}
                isActive={context.activeValue === option.value}
                isSelected={context.value === option.value}
                label={option.label}
                onActivate={context.setActiveValue}
                onSelect={context.selectValue}
                value={option.value}
              />
            </div>
          );
        })}
      </div>
    ) : (
      snapshotOptions.map((option) => (
        <SelectOptionRow
          key={option.id}
          dense={context.dense}
          disabled={option.disabled}
          id={option.id}
          isActive={context.activeValue === option.value}
          isSelected={context.value === option.value}
          label={option.label}
          onActivate={context.setActiveValue}
          onSelect={context.selectValue}
          value={option.value}
        />
      ))
    );

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
      style={{ ...popupStyle, ...(style ?? {}) }}
      animate={false}
      widthMode="content"
    >
      {renderedOptions}
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

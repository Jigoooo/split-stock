import type { ReactElement } from 'react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import {
  buildOptionLookup,
  findBoundaryOption,
  findSelectableOption,
  isSameOptionMeta,
} from '../lib/select-values';
import { SelectContext } from '../model/select-context';
import type { SelectContextValue, SelectOptionMeta, SelectRootProps } from '../model/types';

export const SelectRoot = ({
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

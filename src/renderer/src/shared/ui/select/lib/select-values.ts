import type { ChangeEvent, ReactElement, ReactNode, SelectHTMLAttributes } from 'react';
import { Children, Fragment, isValidElement } from 'react';
import type { SelectOptionLookup, SelectOptionMeta } from '../model/types';

export const SELECT_OPTION_GAP_PX = 2;
export const SELECT_OPTION_HEIGHT_PX = 28;
export const SELECT_OPTION_DENSE_HEIGHT_PX = 26;
export const SELECT_VIRTUALIZE_THRESHOLD = 80;

export function normalizeSelectValue(
  value: SelectHTMLAttributes<HTMLSelectElement>['value'] | undefined,
): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }

  return value === undefined || value === null ? '' : String(value);
}

export function createSyntheticSelectChangeEvent(
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

export function extractSelectOptions(children: ReactNode): Array<{
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

export function findSelectableOption(
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

export function findBoundaryOption(
  lookup: SelectOptionLookup,
  boundary: 'first' | 'last',
): SelectOptionMeta | null {
  const value = boundary === 'first' ? lookup.enabledValues[0] : lookup.enabledValues.at(-1);
  return value ? (lookup.byValue.get(value) ?? null) : null;
}

export function isSameOptionMeta(left: SelectOptionMeta, right: SelectOptionMeta): boolean {
  return (
    left.disabled === right.disabled &&
    left.id === right.id &&
    left.label === right.label &&
    left.value === right.value
  );
}

export function buildOptionLookup(options: SelectOptionMeta[]): SelectOptionLookup {
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

export function getSelectOptionEstimateSize(dense: boolean): number {
  return (dense ? SELECT_OPTION_DENSE_HEIGHT_PX : SELECT_OPTION_HEIGHT_PX) + SELECT_OPTION_GAP_PX;
}

export function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

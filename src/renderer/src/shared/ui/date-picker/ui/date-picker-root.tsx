import {
  autoUpdate,
  flip,
  offset,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';

import { DatePickerContextProvider } from '../model/date-picker-context';
import type { DatePickerRootProps } from '../model/types';
import { useDatePicker } from '../model/use-date-picker';

export function DatePickerRoot({
  children,
  className,
  mode = 'day',
  value,
  onChange,
  min,
  max,
  dateFormat,
  placeholder = '날짜를 선택하세요',
  disabled = false,
  style,
}: DatePickerRootProps) {
  const picker = useDatePicker({
    mode,
    value,
    onChange,
    min,
    max,
    dateFormat,
  });

  const { refs, floatingStyles, context } = useFloating({
    open: picker.isOpen,
    onOpenChange: picker.setIsOpen,
    placement: 'bottom-start',
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({
        mainAxis: 6,
      }),
      flip({
        fallbackPlacements: ['top-start', 'bottom-start'],
        fallbackStrategy: 'bestFit',
        padding: 12,
      }),
      size({
        apply({ availableHeight, availableWidth, elements }) {
          const nextWidth = Math.min(272, Math.max(236, availableWidth));
          const nextMaxHeight = Math.min(availableHeight, 328);

          Object.assign(elements.floating.style, {
            width: `${nextWidth}px`,
            maxWidth: `${nextWidth}px`,
            minWidth: `${Math.min(nextWidth, 236)}px`,
            maxHeight: `${nextMaxHeight}px`,
          });
        },
        padding: 12,
      }),
    ],
  });

  const click = useClick(context, {
    enabled: !disabled,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  return (
    <DatePickerContextProvider
      value={{
        mode,
        dateFormat,
        disabled,
        placeholder,
        isOpen: picker.isOpen,
        setIsOpen: picker.setIsOpen,
        selectedDate: picker.selectedDate,
        currentDate: picker.currentDate,
        setCurrentDate: picker.setCurrentDate,
        displayMode: picker.displayMode,
        setDisplayMode: picker.setDisplayMode,
        minDate: picker.minDate,
        maxDate: picker.maxDate,
        placement: context.placement,
        commitSelection: picker.commitSelection,
        setReference: refs.setReference as (node: HTMLElement | null) => void,
        setFloating: refs.setFloating,
        floatingStyles,
        getReferenceProps,
        getFloatingProps,
      }}
    >
      <div
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          ...style,
        }}
      >
        {children}
      </div>
    </DatePickerContextProvider>
  );
}

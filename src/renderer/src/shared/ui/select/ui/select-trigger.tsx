import { ChevronDown } from 'lucide-react';
import type { FocusEvent, FocusEventHandler, ReactElement } from 'react';
import { useEffect } from 'react';
import { joinClasses } from '../lib/select-values';
import { useSelectContext } from '../model/select-context';
import type { SelectTriggerProps } from '../model/types';
import { SelectValue } from './select-value';

export const SelectTrigger = ({
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

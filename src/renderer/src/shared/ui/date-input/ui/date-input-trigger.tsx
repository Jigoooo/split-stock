import { CalendarDays } from 'lucide-react';
import type { ReactElement } from 'react';
import { memo } from 'react';
import { joinClasses } from '../lib/date-input-values';
import { useDatePickerContext } from '../model/date-input-context';
import type { DateInputTriggerProps } from '../model/types';

export const DateInputTrigger = memo(
  ({
    'aria-label': ariaLabel,
    className,
    onClick,
    title = '날짜 선택기 열기',
    ...props
  }: DateInputTriggerProps): ReactElement => {
    const context = useDatePickerContext('DateInput.Trigger');

    return (
      <button
        {...props}
        className={joinClasses('hts-date-shell__trigger', className)}
        disabled={context.disabled}
        title={title}
        type="button"
        aria-label={ariaLabel ?? '날짜 선택기 열기'}
        aria-controls={`${context.inputId}-calendar`}
        aria-expanded={context.open}
        aria-haspopup="dialog"
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || context.disabled) return;

          if (context.open) {
            context.commitDraft({ shouldClose: true });
            return;
          }

          context.setViewMode('day');
          context.setOpen(true);
        }}
      >
        {props.children ?? <CalendarDays size={15} aria-hidden />}
      </button>
    );
  },
);

DateInputTrigger.displayName = 'DateInputTrigger';

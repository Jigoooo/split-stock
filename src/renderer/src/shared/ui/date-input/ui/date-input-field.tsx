import type {
  ChangeEvent,
  ClipboardEvent,
  FocusEvent,
  FocusEventHandler,
  KeyboardEvent,
  ReactElement,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { Fragment, memo, useEffect } from 'react';
import {
  clampPartsToValidDate,
  createSegmentLabel,
  DATE_SEGMENT_LENGTH,
  DATE_SEGMENT_ORDER,
  DATE_SEGMENT_PLACEHOLDER,
  findSegmentFromTarget,
  getAdjacentSegment,
  isFocusableTarget,
  joinClasses,
  parseRecoverableDraft,
  sanitizeSegmentDraft,
} from '../lib/date-input-values';
import { useDateInputFieldContext } from '../model/date-input-context';
import type { DateInputFieldProps, DateSegmentName } from '../model/types';

export const DateInputField = memo(
  ({
    'aria-label': ariaLabel,
    autoFocus,
    className,
    id,
    name,
    onBlur,
    onFocus,
    onKeyDown,
    placeholder = 'YYYY-MM-DD',
    required,
    title,
    ...props
  }: DateInputFieldProps): ReactElement => {
    const context = useDateInputFieldContext('DateInput.Field');
    const separator = placeholder?.includes('.') ? '.' : '-';

    useEffect(() => {
      if (!autoFocus) return;
      context.focusSegment('year');
    }, [autoFocus, context.focusSegment]);

    const handleBlur =
      (segment: DateSegmentName): FocusEventHandler<HTMLInputElement> =>
      (event) => {
        onBlur?.(event);

        const nextSegment = findSegmentFromTarget(event.relatedTarget, context.inputRefs);
        if (nextSegment) {
          context.commitDraft();
          if (nextSegment !== segment) {
            window.requestAnimationFrame(() => {
              const target = context.inputRefs[nextSegment].current;
              if (target && document.activeElement === target) {
                target.select();
              }
            });
          }
          return;
        }

        if (isFocusableTarget(event.relatedTarget, context.popupRef.current)) {
          return;
        }

        if (isFocusableTarget(event.relatedTarget, context.rootRef.current)) {
          context.commitDraft();
          return;
        }

        context.commitDraft({ shouldClose: context.open });
      };

    const handleKeyDown =
      (segment: DateSegmentName) =>
      (event: KeyboardEvent<HTMLInputElement>): void => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        if (event.key === 'Enter') {
          event.preventDefault();
          context.commitDraft({ shouldClose: true });
          return;
        }

        if (event.key === 'Escape' && context.open) {
          event.preventDefault();
          context.dismissPopup('escape');
          return;
        }

        if (event.key === '.' || event.key === '-' || event.key === '/') {
          const next = getAdjacentSegment(segment, 1);
          if (!next) return;
          event.preventDefault();
          context.focusSegment(next);
          return;
        }

        if (event.key === 'ArrowLeft') {
          const previous = getAdjacentSegment(segment, -1);
          if (!previous) return;
          event.preventDefault();
          context.focusSegment(previous);
          return;
        }

        if (event.key === 'ArrowRight') {
          const next = getAdjacentSegment(segment, 1);
          if (!next) return;
          event.preventDefault();
          context.focusSegment(next);
          return;
        }

        if (event.key === 'Backspace' && context.draftParts[segment] === '') {
          const previous = getAdjacentSegment(segment, -1);
          if (!previous) return;
          event.preventDefault();
          context.focusSegment(previous);
        }
      };

    const handleChange =
      (segment: DateSegmentName) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        const nextValue = sanitizeSegmentDraft(event.target.value, segment);
        context.setDraftPart(segment, nextValue);

        if (nextValue.length !== DATE_SEGMENT_LENGTH[segment]) return;

        const next = getAdjacentSegment(segment, 1);
        if (next) {
          context.focusSegment(next);
        }
      };

    const handleFocus =
      (segment: DateSegmentName) =>
      (event: FocusEvent<HTMLInputElement>): void => {
        context.setActiveSegment(segment);
        onFocus?.(event);
        const input = event.currentTarget;
        window.requestAnimationFrame(() => {
          if (!input.isConnected) return;
          input.select();
        });
      };

    const handleMouseUp = (event: ReactMouseEvent<HTMLInputElement>): void => {
      event.preventDefault();
    };

    const handlePaste =
      (segment: DateSegmentName) =>
      (event: ClipboardEvent<HTMLInputElement>): void => {
        const pasted = event.clipboardData.getData('text');
        const recoverable = parseRecoverableDraft(pasted);
        if (!recoverable) return;

        event.preventDefault();
        const normalized = clampPartsToValidDate(recoverable);
        context.setDraftPart('year', sanitizeSegmentDraft(String(normalized.year), 'year'));
        context.setDraftPart('month', sanitizeSegmentDraft(String(normalized.month), 'month'));
        context.setDraftPart('day', sanitizeSegmentDraft(String(normalized.day), 'day'));

        const next = getAdjacentSegment(segment, 1) ?? 'day';
        context.focusSegment(next);
      };

    return (
      <fieldset className={joinClasses('hts-date-shell__fields', className)} aria-label={ariaLabel}>
        {name ? <input name={name} readOnly type="hidden" value={context.value} /> : null}
        {DATE_SEGMENT_ORDER.map((segment, index) => (
          <Fragment key={segment}>
            <input
              {...props}
              ref={context.inputRefs[segment]}
              aria-label={createSegmentLabel(ariaLabel, segment)}
              className={joinClasses(
                'hts-date-shell__field',
                'hts-date-shell__field--part',
                `hts-date-shell__field--${segment}`,
              )}
              disabled={context.disabled}
              id={segment === 'year' ? (id ?? context.inputId) : undefined}
              inputMode="numeric"
              maxLength={DATE_SEGMENT_LENGTH[segment]}
              placeholder={DATE_SEGMENT_PLACEHOLDER[segment]}
              required={required}
              title={title}
              type="text"
              value={context.draftParts[segment]}
              onBlur={handleBlur(segment)}
              onChange={handleChange(segment)}
              onFocus={handleFocus(segment)}
              onKeyDown={handleKeyDown(segment)}
              onMouseUp={handleMouseUp}
              onPaste={handlePaste(segment)}
            />
            {index < DATE_SEGMENT_ORDER.length - 1 ? (
              <span className="hts-date-shell__separator" aria-hidden>
                {separator}
              </span>
            ) : null}
          </Fragment>
        ))}
      </fieldset>
    );
  },
);

DateInputField.displayName = 'DateInputField';

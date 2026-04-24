import { useVirtualizer } from '@tanstack/react-virtual';
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { ControlPopup } from '../../control-popup';
import {
  getSelectOptionEstimateSize,
  joinClasses,
  SELECT_OPTION_GAP_PX,
  SELECT_VIRTUALIZE_THRESHOLD,
} from '../lib/select-values';
import { useSelectContext } from '../model/select-context';
import type { SelectContentProps } from '../model/types';
import { SelectOptionRow } from './select-option-row';

export function SelectContentWithPopupRef({
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

  useEffect(() => {
    if (!context.open || shouldVirtualize || context.activeValue === '') return;

    const activeOption = context.optionLookup.byValue.get(context.activeValue);
    if (!activeOption) return;

    const frame = window.requestAnimationFrame(() => {
      const popup = popupRef.current;
      const optionElement = document.getElementById(activeOption.id);
      if (!popup || !optionElement || !popup.contains(optionElement)) return;

      const popupRect = popup.getBoundingClientRect();
      const optionRect = optionElement.getBoundingClientRect();
      const paddingPx = 6;

      if (optionRect.top < popupRect.top + paddingPx) {
        popup.scrollTop -= popupRect.top + paddingPx - optionRect.top;
        return;
      }

      if (optionRect.bottom > popupRect.bottom - paddingPx) {
        popup.scrollTop += optionRect.bottom - (popupRect.bottom - paddingPx);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [context.activeValue, context.open, context.optionLookup, shouldVirtualize]);

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

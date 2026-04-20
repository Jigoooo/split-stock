import { forwardRef, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { RowProps } from '../model/types';

/**
 * TableGrid.Row — flex row.
 * - selected/expanded/flash 상태 data-attr 로 노출 (CSS 분기)
 * - forwardRef — 가상화 시 measureElement 부착
 * - onClick 지정 시 role="button" + Enter/Space 키보드 활성화 + tabIndex=0 (a11y)
 *
 * onClick 미지정 시에는 어떤 인터랙션 props 도 DOM 에 부착하지 않음 (lint a11y 회피).
 */
export const TableGridRow = forwardRef<HTMLDivElement, RowProps>(
  function TableGridRow(props, ref): ReactElement {
    const {
      selected = false,
      expanded = false,
      flash = null,
      onClick,
      onContextMenu,
      placeholder = false,
      className,
      style,
      children,
      ...rest
    } = props;

    const hasInteraction = Boolean(onClick || onContextMenu);

    const interactiveProps = onClick
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick,
          onContextMenu,
          onKeyDown: (e: KeyboardEvent<HTMLDivElement>): void => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick(e as unknown as MouseEvent<HTMLDivElement>);
            }
          },
        }
      : onContextMenu
        ? { role: 'row' as const, onContextMenu }
        : {};

    return (
      <div
        ref={ref}
        data-grid-role="row"
        data-selected={selected || undefined}
        data-expanded={expanded || undefined}
        data-flash={flash ?? undefined}
        data-placeholder={placeholder || undefined}
        data-key={rest['data-key']}
        {...interactiveProps}
        className={[
          'table-grid-row',
          placeholder ? 'table-grid-row--placeholder' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexShrink: 0,
          boxSizing: 'border-box',
          cursor: hasInteraction ? 'pointer' : 'default',
          ...style,
        }}
      >
        {children}
      </div>
    );
  },
);

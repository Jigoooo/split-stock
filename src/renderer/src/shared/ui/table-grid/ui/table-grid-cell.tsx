import { type CSSProperties, type ReactElement, useLayoutEffect, useRef } from 'react';
import type { CellProps, OverflowMode } from '../model/types';
import { useTableGridContext } from './table-grid-root';

const overflowStyle = (mode: OverflowMode): CSSProperties => {
  switch (mode) {
    case 'nowrap':
      return { whiteSpace: 'nowrap', overflow: 'hidden' };
    case 'ellipsis':
      return { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
    case 'wrap':
      return { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere' };
    case 'scroll':
      return { whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden' };
  }
};

const overflowClass = (mode: OverflowMode): string => `table-grid-cell--ovf-${mode}`;

/**
 * TableGrid.Cell — flex item.
 * - width 는 컬럼 기준 폭(number→px). 실제 콘텐츠가 더 넓으면 컬럼 전체가 함께 확장.
 * - align/overflow/numeric 옵션.
 * - numeric=true → align right + mono + tabular-nums.
 * - sticky="right" → 가로 스크롤 시 우측 고정 (액션 컬럼 등)
 *
 * 셀 내부 인터랙션이 필요하면 children 에 <button> 등 시맨틱 요소를 직접 배치.
 */
interface TableGridCellInternalProps extends CellProps {
  columnIndex?: number;
}

export function TableGridCell(props: TableGridCellInternalProps): ReactElement {
  const {
    width,
    flex,
    minWidth,
    maxWidth,
    align,
    overflow = 'nowrap',
    numeric = false,
    sticky,
    className,
    style,
    title,
    children,
    columnIndex,
  } = props;
  const { columnWidths, reportColumnWidth } = useTableGridContext();
  const cellRef = useRef<HTMLDivElement | null>(null);

  const resolvedWidth =
    width !== undefined ? Math.max(width, columnWidths[columnIndex ?? -1] ?? 0) : undefined;

  const flexBasis: CSSProperties =
    resolvedWidth !== undefined
      ? { width: resolvedWidth, minWidth: minWidth ?? resolvedWidth, flex: '0 0 auto' }
      : flex !== undefined
        ? { flex: `${flex} ${flex} 0%`, minWidth: 0 }
        : { flex: '1 1 0%', minWidth: 0 };

  const finalAlign = align ?? (numeric ? 'right' : undefined);

  const stickyStyle: CSSProperties = sticky
    ? {
        position: 'sticky',
        [sticky]: 0,
        zIndex: 1,
        // 좌/우 구분선
        ...(sticky === 'right'
          ? { borderLeft: '1px solid var(--border-strong, rgba(0,0,0,0.15))' }
          : {}),
        ...(sticky === 'left'
          ? { borderRight: '1px solid var(--border-strong, rgba(0,0,0,0.15))' }
          : {}),
      }
    : {};

  useLayoutEffect(() => {
    if (width === undefined || columnIndex === undefined) {
      return;
    }

    const el = cellRef.current;
    if (!el) {
      return;
    }

    reportColumnWidth(columnIndex, Math.max(width, el.scrollWidth));
  });

  return (
    <div
      ref={cellRef}
      data-grid-role="cell"
      data-numeric={numeric || undefined}
      data-overflow={overflow}
      data-sticky={sticky || undefined}
      title={title}
      className={[
        'table-grid-cell',
        numeric ? 'table-grid-cell--num' : '',
        sticky ? `table-grid-cell--sticky-${sticky}` : '',
        overflowClass(overflow),
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        boxSizing: 'border-box',
        ...flexBasis,
        ...(width === undefined && minWidth !== undefined ? { minWidth } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
        ...(finalAlign ? { textAlign: finalAlign } : {}),
        ...overflowStyle(overflow),
        ...stickyStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
